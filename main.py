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
EXCEL_PATH = BASE_DIR / "FACTURACION CUADRO ESTADISTICA.xlsx"

MESES = ["enero", "febrero", "marzo"]
MES_LABELS = {"enero": "ENERO", "febrero": "FEBRERO", "marzo": "MARZO"}

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
    try:
        if value is None:
            return 0.0
        if isinstance(value, float) and math.isnan(value):
            return 0.0
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


def _month_from_fecha(fecha) -> str | None:
    norm = _strip_accents(str(fecha))
    if "ENERO" in norm:
        return "enero"
    if "FEBRERO" in norm:
        return "febrero"
    if "MARZO" in norm:
        return "marzo"
    return None


def _read_ospg_operativo() -> dict:
    """
    Costos operativos OSPG - se leen desde la hoja 'DETALLE 2' filtrando
    las filas cuyo cliente sea exactamente 'OSPG' (facturacion interna a
    la misma obra social, separada del resto de clientes externos).

    Retorna { baseKey: {enero, febrero, marzo} } solo para INTERNACION
    y AMBULATORIO (los unicos conceptos OSPG disponibles en la fuente).
    """
    ospg = {
        "FACTURACION INTERNACION": {m: 0.0 for m in MESES},
        "FACTURACION AMBULATORIO": {m: 0.0 for m in MESES},
    }

    try:
        df = pd.read_excel(EXCEL_PATH, sheet_name="DETALLE 2", header=0)
        df.columns = ["fecha", "tipo", "nro", "cliente", "descripcion", "total"]
    except Exception:
        return ospg

    for _, row in df.iterrows():
        cli = row.get("cliente")
        if not isinstance(cli, str):
            continue
        if _strip_accents(cli) != "OSPG":
            continue

        base = _classify_concept(row.get("descripcion"))
        if base not in ospg:
            continue

        mes = _month_from_fecha(row.get("fecha"))
        if not mes:
            continue

        ospg[base][mes] += _safe_float(row.get("total"))

    return ospg


def _build_detalle_aggregates() -> tuple[dict, dict, dict]:
    """
    Procesa la hoja DETALLE:
      - desgloseMap: { baseKey: [ {cliente, total} ordenados desc ] }
      - statsObj: { mes: {internacion, ambulatorio, refacturacion, camasFijas, nc,
                          facturacionTotal, totalFacturado} }
      - rankingGlobal: [ {cliente, total} ordenado desc (sin NCs) ]
    """
    df = pd.read_excel(EXCEL_PATH, sheet_name="DETALLE", header=0)
    df.columns = ["fecha", "tipo", "nro", "cliente", "descripcion", "total"]

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

        mes = _month_from_fecha(row["fecha"])
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
        e = stats["enero"].get(key, 0.0)
        f = stats["febrero"].get(key, 0.0)
        m = stats["marzo"].get(key, 0.0)
        return {
            "concepto": concepto,
            "enero": round(e, 2),
            "febrero": round(f, 2),
            "marzo": round(m, 2),
            "trimestre": round(e + f + m, 2),
        }

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
        ospg_map = _read_ospg_operativo()
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
