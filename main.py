"""
Dashboard de Control de Gestion - Backend
Migracion desde Google Apps Script a FastAPI + Pandas.
"""
from __future__ import annotations

import math
import unicodedata
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
EXCEL_PATH = BASE_DIR / "FACTURACION CUADRO ESTADISTICA ABRIL-JUNIO.xlsx"

MESES = ["abril", "mayo", "junio"]
MES_LABELS = {"abril": "ABRIL", "mayo": "MAYO", "junio": "JUNIO"}

DETALLE_SHEET = "DETALLE"
OSPG_SHEET = "DETALLE 2"

# Las hojas DETALLE no siempre traen las mismas columnas: la exportacion nueva
# incluye PERIODO y Cod. cliente (8 columnas) y la vieja no (6 columnas). Se
# resuelve por nombre de encabezado y, si no se reconoce, por posicion.
REQUIRED_FIELDS = ("periodo", "cliente", "descripcion", "total")

POSITIONAL_LAYOUTS = {
    6: ["periodo", "tipo", "nro", "cliente", "descripcion", "total"],
    8: ["periodo", "fecha", "tipo", "nro", "codCliente", "cliente", "descripcion", "total"],
}

BASE_KEYS = [
    "FACTURACION INTERNACION",
    "FACTURACION AMBULATORIO",
    "REFACTURACION",
    "NC EMITIDAS",
    "CAMAS FIJAS",
]

app = FastAPI(title="Dashboard Control Gestion", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _strip_accents(text: str) -> str:
    if not isinstance(text, str):
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip().upper()


def _safe_float(value) -> float:
    """
    Convierte a float tolerando importes pegados como texto
    ('-$ 1.234.567,89'), que es como quedan al copiar celdas con formato.
    """
    if value is None:
        return 0.0
    if isinstance(value, float) and math.isnan(value):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        txt = value.strip()
        if not txt:
            return 0.0
        negativo = txt.startswith("-") or (txt.startswith("(") and txt.endswith(")"))
        limpio = "".join(c for c in txt if c.isdigit() or c in ".,")
        if not limpio:
            return 0.0
        # El ultimo separador que aparece es el decimal; el resto son miles.
        corte = max(limpio.rfind("."), limpio.rfind(","))
        if corte != -1 and len(limpio) - corte - 1 in (1, 2):
            entero = limpio[:corte].replace(".", "").replace(",", "")
            decimal = limpio[corte + 1:]
            limpio = f"{entero}.{decimal}"
        else:
            limpio = limpio.replace(".", "").replace(",", "")
        try:
            num = float(limpio)
        except ValueError:
            return 0.0
        return -num if negativo else num

    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _classify_concept(descripcion: str) -> str | None:
    """Mapea la columna Descripcion de DETALLE al baseKey de negocio."""
    norm = _strip_accents(descripcion)
    if "NOTA DE CREDITO" in norm or norm == "NC":
        return "NC EMITIDAS"
    if "REFACTURACION" in norm:
        return "REFACTURACION"
    if "CAMAS FIJAS" in norm:
        return "CAMAS FIJAS"
    if "AMBULATORIO" in norm:
        return "FACTURACION AMBULATORIO"
    if "INTERNACION" in norm:
        return "FACTURACION INTERNACION"
    return None


def _month_from_periodo(periodo) -> str | None:
    norm = _strip_accents(str(periodo))
    for mes in MESES:
        if mes.upper() in norm:
            return mes
    return None


def _canonical_field(header) -> str | None:
    """Traduce un encabezado del Excel al nombre interno de la columna."""
    norm = _strip_accents(str(header))
    if "PERIODO" in norm:
        return "periodo"
    if "FECHA" in norm:
        return "fecha"
    if "TIPO" in norm:
        return "tipo"
    if "NRO" in norm or "NUMERO" in norm or "COMPROBANTE" in norm:
        return "nro"
    if "COD" in norm and "CLIENTE" in norm:
        return "codCliente"
    if "RAZON" in norm or "CLIENTE" in norm:
        return "cliente"
    if "DESCRIPCION" in norm or "CONCEPTO" in norm:
        return "descripcion"
    if "TOTAL" in norm or "IMPORTE" in norm:
        return "total"
    return None


def _read_detalle(sheet_name: str) -> pd.DataFrame:
    """
    Lee una hoja DETALLE normalizando los nombres de columna.

    Primero intenta mapear por encabezado; si la hoja no trae encabezados
    reconocibles cae al layout posicional segun la cantidad de columnas.
    """
    df = pd.read_excel(EXCEL_PATH, sheet_name=sheet_name, header=0)

    resueltas: list[str] = []
    vistas: set[str] = set()
    for i, header in enumerate(df.columns):
        campo = _canonical_field(header)
        if campo and campo not in vistas:
            vistas.add(campo)
            resueltas.append(campo)
        else:
            resueltas.append(f"_col{i}")

    if not all(campo in vistas for campo in REQUIRED_FIELDS):
        layout = POSITIONAL_LAYOUTS.get(len(df.columns))
        if layout is None:
            faltantes = [c for c in REQUIRED_FIELDS if c not in vistas]
            raise ValueError(
                f"La hoja '{sheet_name}' tiene {len(df.columns)} columnas y no se "
                f"pudieron identificar por encabezado: falta {', '.join(faltantes)}"
            )
        resueltas = layout

    df.columns = resueltas
    return df


def _find_sheet(nombre: str) -> str | None:
    """
    Busca una hoja ignorando mayusculas, acentos y espacios, para que
    'DETALLE 2', 'Detalle 2' y 'DETALLE2' se resuelvan igual.
    """
    objetivo = _strip_accents(nombre).replace(" ", "")
    for hoja in pd.ExcelFile(EXCEL_PATH).sheet_names:
        if _strip_accents(hoja).replace(" ", "") == objetivo:
            return hoja
    return None


def _scan_ospg(df: pd.DataFrame) -> tuple[dict, dict]:
    """
    Recorre una hoja de detalle y acumula las filas de costos OSPG.

    Devuelve ({ baseKey: {mes: monto} }, diagnostico). El diagnostico lista
    las filas OSPG descartadas con su numero de fila del Excel, para que un
    dato mal cargado se vea en /api/data en vez de desaparecer en un cero.
    """
    ospg = {
        "FACTURACION INTERNACION": {m: 0.0 for m in MESES},
        "FACTURACION AMBULATORIO": {m: 0.0 for m in MESES},
    }
    diagnostico: dict = {"filasLeidas": 0, "omitidas": []}

    def omitir(fila: int, motivo: str, detalle) -> None:
        diagnostico["omitidas"].append(
            {"fila": fila, "motivo": motivo, "valor": str(detalle)[:80]}
        )

    for pos, (_, row) in enumerate(df.iterrows(), start=2):  # +2: encabezado y base 1
        cli = row.get("cliente")
        if not isinstance(cli, str):
            continue

        cli_norm = _strip_accents(cli)
        if "OSPG" not in cli_norm:
            continue
        if cli_norm != "OSPG":
            omitir(pos, "razon social no es exactamente 'OSPG'", cli)
            continue

        base = _classify_concept(row.get("descripcion"))
        if base is None:
            omitir(pos, "descripcion no reconocida", row.get("descripcion"))
            continue
        if base not in ospg:
            omitir(pos, f"concepto '{base}' no se reporta como costo OSPG",
                   row.get("descripcion"))
            continue

        mes = _month_from_periodo(row.get("periodo"))
        if not mes:
            omitir(pos, "periodo sin mes del trimestre", row.get("periodo"))
            continue

        monto = _safe_float(row.get("total"))
        if monto == 0.0 and row.get("total") not in (None, 0, 0.0, ""):
            omitir(pos, "importe ilegible", row.get("total"))
            continue

        ospg[base][mes] += monto
        diagnostico["filasLeidas"] += 1

    return ospg, diagnostico


def _read_ospg_operativo() -> tuple[dict, str | None, dict]:
    """
    Costos operativos OSPG: filas cuya razon social es exactamente 'OSPG'
    (facturacion interna a la misma obra social, separada del resto de
    clientes externos). En esas filas el periodo viene prefijado
    ('OSPG ABRIL') y el comprobante queda vacio.

    Pueden estar en una hoja aparte ('DETALLE 2', como en el 1T) o
    intercaladas en la propia 'DETALLE'. Se usa la primera hoja que traiga
    filas OSPG y nunca las dos, para no duplicar montos. No hay riesgo de
    contar dos veces contra la facturacion externa porque
    _build_detalle_aggregates ya excluye a los clientes OSPG.

    Retorna ({ baseKey: {mes: monto} }, hoja_usada, diagnostico), con
    hoja_usada = None si todavia no se cargaron los costos.
    """
    for nombre in (OSPG_SHEET, DETALLE_SHEET):
        hoja = _find_sheet(nombre)
        if hoja is None:
            continue

        # Si la hoja esta mal armada conviene que el error se vea, en lugar
        # de mostrar un cero que parece un dato real.
        ospg, diagnostico = _scan_ospg(_read_detalle(hoja))
        if diagnostico["filasLeidas"] or diagnostico["omitidas"]:
            return ospg, hoja, diagnostico

    vacio = {
        "FACTURACION INTERNACION": {m: 0.0 for m in MESES},
        "FACTURACION AMBULATORIO": {m: 0.0 for m in MESES},
    }
    return vacio, None, {"filasLeidas": 0, "omitidas": []}


def _build_detalle_aggregates() -> tuple[dict, dict, dict]:
    """
    Procesa la hoja DETALLE:
      - desgloseMap: { baseKey: [ {cliente, total} ordenados desc ] }
      - statsObj: { mes: {internacion, ambulatorio, refacturacion, camasFijas, nc,
                          facturacionTotal, totalFacturado} }
      - rankingGlobal: [ {cliente, total} ordenado desc (sin NCs) ]
    """
    df = _read_detalle(_find_sheet(DETALLE_SHEET) or DETALLE_SHEET)

    desglose: dict[str, dict[str, float]] = {k: {} for k in BASE_KEYS}
    stats: dict[str, dict[str, float]] = {
        m: {
            "internacion": 0.0,
            "ambulatorio": 0.0,
            "refacturacion": 0.0,
            "camasFijas": 0.0,
            "nc": 0.0,
            "facturacionTotal": 0.0,
            "totalFacturado": 0.0,
        }
        for m in MESES
    }
    ranking: dict[str, float] = {}

    for _, row in df.iterrows():
        cliente_raw = row["cliente"]
        if not isinstance(cliente_raw, str):
            continue
        cliente = cliente_raw.strip()
        if not cliente:
            continue

        cli_norm = _strip_accents(cliente)
        if cli_norm == "RAZON SOCIAL" or "OSPG" in cli_norm:
            continue

        base = _classify_concept(row["descripcion"])
        if not base:
            continue

        mes = _month_from_periodo(row["periodo"])
        if not mes:
            continue

        total = _safe_float(row["total"])

        desglose[base][cliente] = desglose[base].get(cliente, 0.0) + total

        st = stats[mes]
        if base == "FACTURACION INTERNACION":
            st["internacion"] += total
            st["facturacionTotal"] += total
            st["totalFacturado"] += total
        elif base == "FACTURACION AMBULATORIO":
            st["ambulatorio"] += total
            st["facturacionTotal"] += total
            st["totalFacturado"] += total
        elif base == "REFACTURACION":
            st["refacturacion"] += total
            st["facturacionTotal"] += total
            st["totalFacturado"] += total
        elif base == "CAMAS FIJAS":
            st["camasFijas"] += total
            st["facturacionTotal"] += total
            st["totalFacturado"] += total
        elif base == "NC EMITIDAS":
            st["nc"] += total
            st["totalFacturado"] += total

        if base != "NC EMITIDAS":
            ranking[cliente] = ranking.get(cliente, 0.0) + total

    desglose_map = {
        base: sorted(
            [{"cliente": c, "total": round(v, 2)} for c, v in clientes.items()],
            key=lambda r: r["total"],
            reverse=True,
        )
        for base, clientes in desglose.items()
    }

    ranking_global = sorted(
        [{"cliente": c, "total": round(v, 2)} for c, v in ranking.items()],
        key=lambda r: r["total"],
        reverse=True,
    )

    return desglose_map, stats, ranking_global


def _build_tabla_principal(stats: dict) -> list[dict]:
    """Tabla principal con un fila por concepto y columnas mensuales + trimestre."""
    def row(concepto: str, key: str) -> dict:
        valores = {m: stats[m].get(key, 0.0) for m in MESES}
        fila = {"concepto": concepto}
        fila.update({m: round(v, 2) for m, v in valores.items()})
        fila["trimestre"] = round(sum(valores.values()), 2)
        return fila

    return [
        row("FACTURACION INTERNACION", "internacion"),
        row("FACTURACION AMBULATORIO", "ambulatorio"),
        row("REFACTURACION", "refacturacion"),
        row("CAMAS FIJAS", "camasFijas"),
        row("FACTURACION TOTAL", "facturacionTotal"),
        row("NC EMITIDAS", "nc"),
        row("TOTAL FACTURADO", "totalFacturado"),
    ]


@app.get("/api/data")
def get_data():
    if not EXCEL_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Archivo no encontrado: {EXCEL_PATH}",
        )

    try:
        ospg_map, ospg_fuente, ospg_diag = _read_ospg_operativo()
        desglose_map, stats, ranking_global = _build_detalle_aggregates()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Hoja no encontrada o invalida: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error procesando Excel: {exc}")

    tabla_principal = _build_tabla_principal(stats)

    # Totales OSPG por mes (suma de Internacion + Ambulatorio) + trimestre
    ospg_totals = {
        "porMes": {
            m: round(
                ospg_map.get("FACTURACION INTERNACION", {}).get(m, 0.0)
                + ospg_map.get("FACTURACION AMBULATORIO", {}).get(m, 0.0),
                2,
            )
            for m in MESES
        },
        "porConcepto": {
            k: round(sum(v.values()), 2) for k, v in ospg_map.items()
        },
    }
    ospg_totals["trimestre"] = round(sum(ospg_totals["porMes"].values()), 2)
    # Permite distinguir "OSPG en cero" de "OSPG todavia sin cargar".
    ospg_totals["fuente"] = ospg_fuente
    ospg_totals["disponible"] = ospg_fuente is not None
    ospg_totals["filasLeidas"] = ospg_diag["filasLeidas"]
    ospg_totals["omitidas"] = ospg_diag["omitidas"]

    # Limpiar floats residuales del Excel para que el JSON sea estable
    ospg_map_clean = {
        k: {m: round(v.get(m, 0.0), 2) for m in MESES}
        for k, v in ospg_map.items()
    }

    stats_list = [
        {
            "mes": MES_LABELS[m],
            "mesKey": m,
            "internacion": round(stats[m]["internacion"], 2),
            "ambulatorio": round(stats[m]["ambulatorio"], 2),
            "refacturacion": round(stats[m]["refacturacion"], 2),
            "camasFijas": round(stats[m]["camasFijas"], 2),
            "nc": round(stats[m]["nc"], 2),
            "facturacionTotal": round(stats[m]["facturacionTotal"], 2),
            "totalFacturado": round(stats[m]["totalFacturado"], 2),
            "ospgInternacion": round(ospg_map.get("FACTURACION INTERNACION", {}).get(m, 0.0), 2),
            "ospgAmbulatorio": round(ospg_map.get("FACTURACION AMBULATORIO", {}).get(m, 0.0), 2),
            "ospgTotal": ospg_totals["porMes"][m],
        }
        for m in MESES
    ]

    return {
        "tablaPrincipal": tabla_principal,
        "rankingGlobal": ranking_global,
        "desgloseMap": desglose_map,
        "ospgMap": ospg_map_clean,
        "ospgTotals": ospg_totals,
        "stats": stats_list,
    }


@app.get("/")
def root_index():
    return FileResponse(BASE_DIR / "index.html")


app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")
app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="root")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
