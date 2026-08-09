# Dashboard de Control de Gestión - Informe de Cobranzas 

Una aplicación web analítica diseñada para procesar, auditar y visualizar de forma dinámica los informes de facturación y cobranzas de OSPG. El sistema permite cargar un archivo Excel estándar y transforma los datos crudos en un tablero interactivo con KPIs, gráficos de evolución y ranking de clientes.

## Arquitectura del Proyecto

El proyecto utiliza una arquitectura desacoplada (Frontend y Backend separados) para garantizar máxima velocidad de carga en la interfaz y un procesamiento robusto de los datos en la nube.

* **Frontend (La Vidriera):** Interfaz gráfica interactiva que se encarga de la experiencia del usuario y las animaciones. Alojado de forma estática.
* **Backend (El Motor):** API RESTful que recibe el archivo Excel, lo procesa en memoria utilizando librerías de análisis de datos y devuelve un JSON estructurado.

## Tecnologías Utilizadas

**Backend:**
* [Python 3.11](https://www.python.org/)
* [FastAPI](https://fastapi.tiangolo.com/) - Framework web para la API.
* [Pandas](https://pandas.pydata.org/) - Análisis y manipulación de datos.
* [Uvicorn](https://www.uvicorn.org/) - Servidor ASGI.
* [OpenPyXL](https://openpyxl.readthedocs.io/en/stable/) - Motor para lectura de archivos `.xlsx`.

**Frontend:**
* HTML5 / CSS3
* JavaScript (Vanilla)
* [Anime.js](https://animejs.com/) - Animaciones fluidas en el despliegue de tablas y gráficos.

## Instalación y Uso Local

Si deseas correr este proyecto en tu propia máquina para desarrollo o pruebas:

### 1. Clonar el repositorio
```bash
git clone [https://github.com/gastonhuerta14/informe-cobranzas.git](https://github.com/gastonhuerta14/informe-cobranzas.git)
cd informe-cobranzas
2. Levantar el Backend
Se recomienda crear un entorno virtual antes de instalar las dependencias.

Bash
# Instalar dependencias
pip install -r requirements.txt

# Iniciar el servidor local
uvicorn main:app --reload
El backend estará escuchando en http://127.0.0.1:8000.

3. Levantar el Frontend
Simplemente abre el archivo index.html en tu navegador o utiliza extensiones como Live Server en VS Code.

Nota sobre CORS: En el entorno local, asegúrate de que tu script.js apunte al localhost:8000 y no a la URL de producción.

Despliegue en Producción
El sistema está configurado para un despliegue continuo en la nube utilizando dos plataformas:

Render (Backend):

Desplegado como un Web Service.

Variables de entorno clave: PYTHON_VERSION = 3.11.9.

Comando de inicio: uvicorn main:app --host 0.0.0.0 --port $PORT.

Expone el endpoint /api/data habilitado con CORS (allow_origins=["*"]) para recibir peticiones externas.

Netlify (Frontend):

Desplegado como un Static Site.

Variables de entorno clave: PYTHON_VERSION = 3.11.9 (para evitar errores de build de Netlify al detectar el requirements.txt).

Build command: Vacío (para evitar instalaciones innecesarias).

Privacidad de Datos
El sistema procesa los informes de cobranzas íntegramente en memoria (BytesIO). Los archivos Excel subidos por los usuarios no se guardan en ningún disco local ni base de datos del servidor, garantizando la confidencialidad de la información financiera en cada consulta.
