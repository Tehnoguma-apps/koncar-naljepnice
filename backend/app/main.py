import asyncio
import os
import traceback
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .extraction import (
    build_labels,
    extract_document,
    InsufficientQuotaError,
    OpenAIRateLimitError,
    OpenAITimeoutError,
)
from .label_generator import generate_labels_pdf, generate_labels_png
from .models import GenerateLabelsRequest, NarudzbaData, OutputFormat

app = FastAPI(
    title="Končar Naljepnice API",
    description="API za ekstrakciju podataka iz narudžbenica i generiranje QA naljepnica",
    version="1.0.0"
)

# CORS middleware - allow frontend origins
# In production, set FRONTEND_URL environment variable
frontend_url = os.getenv("FRONTEND_URL", "")
allowed_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
]
if frontend_url:
    allowed_origins.append(frontend_url)
    # Also allow www version and without trailing slash
    if frontend_url.startswith("https://"):
        allowed_origins.append(frontend_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length"],
)


@app.get("/")
async def root():
    return {"message": "Končar Naljepnice API", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


MAX_FILE_SIZE = 30 * 1024 * 1024  # 30MB
MAX_LABELS = 300  # raširivanje pozicija preko sastavnica može dati puno naljepnica
MAX_FILES = 10


@app.post("/extract", response_model=NarudzbaData)
async def extract_from_pdf(files: List[UploadFile] = File(...)):
    """
    Extract order data from one or more PDF files.

    - One PDF: treated as a self-contained order (all positions become labels).
    - Multiple PDFs: an order document plus one or more bill-of-materials (sastavnica)
      documents. Order positions are matched to assemblies by part number and expanded
      into one label per assembly part (quantities multiplied).

    Each PDF is sent directly to OpenAI (native PDF input) for extraction.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Nije priložena nijedna datoteka")

    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Previše datoteka ({len(files)}). Maksimum je {MAX_FILES}."
        )

    try:
        pdf_bytes_list: list[bytes] = []
        for file in files:
            if not file.filename or not file.filename.lower().endswith('.pdf'):
                raise HTTPException(status_code=400, detail="Samo PDF datoteke su podržane")

            pdf_bytes = await file.read()

            if len(pdf_bytes) > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail=f"Datoteka '{file.filename}' je prevelika "
                           f"({len(pdf_bytes) // (1024*1024)}MB). Maksimum je 30MB."
                )
            pdf_bytes_list.append(pdf_bytes)

        # Extract each PDF concurrently (OpenAI calls run in threads)
        documents = await asyncio.gather(
            *(asyncio.to_thread(extract_document, b) for b in pdf_bytes_list)
        )

        # Link order positions with assemblies and build the label list
        data = build_labels(list(documents))

        return data

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except InsufficientQuotaError as e:
        raise HTTPException(status_code=402, detail=str(e))
    except OpenAIRateLimitError as e:
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        raise HTTPException(status_code=429, detail=str(e), headers=headers)
    except OpenAITimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Greška pri obradi PDF-a: {str(e)}")


@app.post("/generate-pdf")
async def generate_labels(request: GenerateLabelsRequest):
    """
    Generate labels in the specified format.
    
    Supports:
    - PDF: Single PDF file with one label per page (100mm x 100mm)
    - PNG: ZIP file containing PNG images at 300 DPI (optimized for thermal label printers)
    """
    try:
        if not request.labels:
            raise HTTPException(status_code=400, detail="Nema naljepnica za generiranje")

        if len(request.labels) > MAX_LABELS:
            raise HTTPException(
                status_code=400,
                detail=f"Previše naljepnica ({len(request.labels)}). Maksimum je {MAX_LABELS}."
            )

        if request.format == OutputFormat.PNG:
            # Generate PNG ZIP for label printers
            zip_bytes = generate_labels_png(request.labels, dpi=300)
            return Response(
                content=zip_bytes,
                media_type="application/zip",
                headers={
                    "Content-Disposition": 'attachment; filename="naljepnice.zip"',
                    "Content-Length": str(len(zip_bytes)),
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                }
            )
        else:
            # Generate PDF (default)
            pdf_bytes = generate_labels_pdf(request.labels)
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": 'attachment; filename="naljepnice.pdf"',
                    "Content-Length": str(len(pdf_bytes)),
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                }
            )
    
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Greška pri generiranju naljepnica: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
