from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel


class OutputFormat(str, Enum):
    PDF = "pdf"
    PNG = "png"  # Returns ZIP with PNG files at 300 DPI


class DocumentType(str, Enum):
    NARUDZBENICA = "narudzbenica"
    SASTAVNICA = "sastavnica"


class DokumentStavka(BaseModel):
    """Jedna stavka iz dokumenta - pozicija narudžbenice ili dio sastavnice."""
    redni_broj: int
    naziv: str
    broj_dijela: str = ""
    kolicina: str
    naziv_objekta: str = ""
    wbs: str = ""


class ExtrahiraniDokument(BaseModel):
    """Rezultat ekstrakcije jednog PDF-a (narudžbenica ili sastavnica)."""
    document_type: DocumentType
    broj_narudzbe: str = ""  # samo narudžbenica
    broj_sklopa: str = ""    # samo sastavnica (Broj sklopa)
    stavke: List[DokumentStavka]


class Artikl(BaseModel):
    redni_broj: int
    naziv: str
    novi_broj_dijela: str = ""
    stari_broj_dijela: str = ""
    kolicina: str
    naziv_objekta: str
    wbs: str


class NarudzbaData(BaseModel):
    broj_narudzbe: str
    artikli: List[Artikl]


class LabelData(BaseModel):
    naziv: str
    novi_broj_dijela: str = ""
    stari_broj_dijela: str = ""
    kolicina: str
    narudzba: str
    account_category: str = ""
    naziv_objekta: str
    wbs: str
    datum: str = ""


class GenerateLabelsRequest(BaseModel):
    labels: List[LabelData]
    format: OutputFormat = OutputFormat.PDF  # Default to PDF for backwards compatibility

