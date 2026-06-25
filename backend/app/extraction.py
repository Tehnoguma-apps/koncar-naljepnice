import base64
import json
import logging
import re
import time
from typing import List, Optional

import httpx
from openai import APITimeoutError, OpenAI, RateLimitError, APIStatusError

from .config import OPENAI_API_KEY
from .models import (
    Artikl,
    DocumentType,
    DokumentStavka,
    ExtrahiraniDokument,
    NarudzbaData,
)

logger = logging.getLogger(__name__)

MAX_RETRIES = 4


class InsufficientQuotaError(Exception):
    """OpenAI račun nema dovoljno kredita."""
    pass


class OpenAIRateLimitError(Exception):
    """Privremeni rate limit od OpenAI API-ja."""
    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class OpenAITimeoutError(Exception):
    """OpenAI API timeout."""
    pass
API_TIMEOUT = 300  # seconds

# Initialize client lazily
_client: Optional[OpenAI] = None

def get_client() -> OpenAI:
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is not set. Please set it in .env file.")
        _client = OpenAI(
            api_key=OPENAI_API_KEY,
            timeout=httpx.Timeout(API_TIMEOUT, connect=10.0),
        )
    return _client

EXTRACTION_PROMPT = """Ti si ekspert za ekstrakciju strukturiranih podataka iz poslovnih dokumenata tvrtke Končar Energetski Transformatori.

PRVO ODREDI VRSTU DOKUMENTA (document_type):

A) "narudzbenica" - Narudžba/narudžbenica. Prepoznaješ je po:
   - Zaglavlju "Narudžba Br.:" i tablici "Poz. Robe / Datum isporuke / Količina/JM"
   - Pozicijama 10, 20, 30...
   - Labelima "Proj:" i "WBS :"

B) "sastavnica" - Popis sklopova i dijelova (Bill of Materials). Prepoznaješ je po:
   - Naslovu "Popis sklopova i dijelova"
   - Poljima "Naziv sklopa", "Broj sklopa"
   - Tablici sa stupcima "Br / Poz / Broj dijela / Broj crteža / Naziv materijala / Sirovina / Količina"

═══════════════════════════════════════════════════════════
AKO JE document_type = "narudzbenica":
═══════════════════════════════════════════════════════════

- broj_narudzbe: Pronađi uz "Narudžba Br.:" - jedinstveni broj za cijeli dokument (npr. "9550537927")
- broj_sklopa: ostavi prazan string ""
- Za SVAKU poziciju (10, 20, 30...) jedna stavka:
   a) redni_broj: pozicija (10, 20, 30...)
   b) naziv: PUNI opis artikla uključujući SVE dijelove opisa - tip proizvoda, dimenzije (A=140;B=140;C=4) I specifikaciju materijala (NBR 70SH, HGW, INOX). Materijal je DIO naziva, NE broj dijela!
      Primjeri: "TR.BRTVA;A=140;B=140;C=4; NBR 70SH", "LETVICA;A=1146;B=20;C=10;HGW", "HGW DIJELOVI"
   c) broj_dijela: Interna ŠIFRA/kod artikla, npr. "3TBT000008", "5TLC070018", "30NA231104AA14". NIJE materijal. Ako ne postoji, prazan string ""
   d) kolicina: iz stupca "Količina/JM" s jedinicom (npr. "1 KOM", "100 KOM")
   e) naziv_objekta: SAMO ako postoji label "Proj:" - vrijednost (npr. "FE Bulk 448-1"). Inače ""
   f) wbs: SAMO ako postoji label "WBS :" - vrijednost (npr. "T.030M.241109.01.01.01"). Inače ""

═══════════════════════════════════════════════════════════
AKO JE document_type = "sastavnica":
═══════════════════════════════════════════════════════════

- broj_narudzbe: ostavi prazan string ""
- broj_sklopa: vrijednost iz "Broj sklopa" (npr. "30NA231104AA14")
- Za SVAKI redak dijela u tablici jedna stavka:
   a) redni_broj: vrijednost iz stupca "Br" (1, 2, 3...)
   b) naziv: PUNI "Naziv materijala" uključujući dimenzije i materijal (npr. "LETVICA 1;A=3570;B=15;C=5", "LETVICA;A=3240;B=20;C=5;HGW 2372.4;PČ 5")
   c) broj_dijela: vrijednost iz stupca "Broj dijela" (npr. "3W00906923")
   d) kolicina: vrijednost iz stupca "Količina" s jedinicom (npr. "44 PC", "248 PC")
   e) naziv_objekta: prazan string ""
   f) wbs: prazan string ""

VAŽNO:
- Nemoj preskakati nijedan artikl/dio
- Pažljivo spoji sve retke koji čine naziv
- Ako dokument ima više stranica, obradi sve stranice
- Materijal (NBR 70SH, HGW, INOX) uvijek ide u naziv, šifra u broj_dijela

Odgovori ISKLJUČIVO u JSON formatu prema shemi."""

EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "document_type": {
            "type": "string",
            "enum": ["narudzbenica", "sastavnica"],
            "description": "Vrsta dokumenta: 'narudzbenica' (Narudžba Br., pozicije 10/20/30) ili 'sastavnica' (Popis sklopova i dijelova, Broj sklopa)"
        },
        "broj_narudzbe": {
            "type": "string",
            "description": "Broj narudžbe iz 'Narudžba Br.:' (samo za narudzbenicu, inače '')"
        },
        "broj_sklopa": {
            "type": "string",
            "description": "Broj sklopa iz 'Broj sklopa' (samo za sastavnicu, inače '')"
        },
        "stavke": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "redni_broj": {
                        "type": "integer",
                        "description": "Pozicija (narudžbenica: 10/20/30) ili redni broj Br (sastavnica: 1/2/3)"
                    },
                    "naziv": {
                        "type": "string",
                        "description": "PUNI naziv uključujući tip, dimenzije I materijal"
                    },
                    "broj_dijela": {
                        "type": "string",
                        "description": "Interna šifra (narudžbenica) ili Broj dijela (sastavnica). Ako ne postoji, ''"
                    },
                    "kolicina": {
                        "type": "string",
                        "description": "Količina s jedinicom (npr. '1 KOM', '44 PC')"
                    },
                    "naziv_objekta": {
                        "type": "string",
                        "description": "Vrijednost 'Proj:' (narudžbenica). Inače ''"
                    },
                    "wbs": {
                        "type": "string",
                        "description": "Vrijednost 'WBS :' (narudžbenica). Inače ''"
                    }
                },
                "required": ["redni_broj", "naziv", "broj_dijela", "kolicina", "naziv_objekta", "wbs"],
                "additionalProperties": False
            }
        }
    },
    "required": ["document_type", "broj_narudzbe", "broj_sklopa", "stavke"],
    "additionalProperties": False
}


def _request_completion(content: list) -> dict:
    """
    Pošalji zahtjev OpenAI-u s retry logikom za prolazne greške.

    Raises:
        InsufficientQuotaError, OpenAIRateLimitError, OpenAITimeoutError, RuntimeError
    """
    client = get_client()
    response = None

    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": content}],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "dokument_extraction",
                        "strict": True,
                        "schema": EXTRACTION_SCHEMA
                    }
                },
                max_tokens=16384
            )
            break
        except APITimeoutError as e:
            logger.warning("OpenAI API timeout (pokušaj %d/%d)", attempt + 1, MAX_RETRIES)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            raise OpenAITimeoutError(
                "OpenAI API nije odgovorio na vrijeme. Pokušajte ponovo ili s manjim PDF-om."
            ) from e
        except RateLimitError as e:
            # Razlikuj insufficient_quota (trajno) od rate limit (privremeno)
            error_type = None
            if e.body and isinstance(e.body, dict):
                error_type = e.body.get("error", {}).get("type")
            if error_type == "insufficient_quota":
                logger.error("OpenAI račun nema dovoljno kredita (insufficient_quota)")
                raise InsufficientQuotaError(
                    "OpenAI račun nema dovoljno kredita. Dodajte sredstva na https://platform.openai.com/account/billing"
                ) from e
            retry_after = None
            if hasattr(e, "response") and e.response is not None:
                retry_after_str = e.response.headers.get("retry-after") or e.response.headers.get("Retry-After")
                if retry_after_str:
                    try:
                        retry_after = int(retry_after_str)
                    except ValueError:
                        pass
            backoff_times = [5, 15, 30, 60]
            wait = retry_after if retry_after else backoff_times[min(attempt, len(backoff_times) - 1)]
            logger.warning("OpenAI rate limit (pokušaj %d/%d), čekam %ds", attempt + 1, MAX_RETRIES, wait)
            if attempt < MAX_RETRIES - 1:
                time.sleep(wait)
                continue
            raise OpenAIRateLimitError(
                "Previše zahtjeva prema OpenAI API-u. Pričekajte minutu i pokušajte ponovo.",
                retry_after=retry_after,
            ) from e
        except APIStatusError as e:
            logger.error("OpenAI APIStatusError %d: %s", e.status_code, e.message)
            logger.error("Response body: %s", e.body)
            if e.status_code in (500, 502, 503) and attempt < MAX_RETRIES - 1:
                logger.warning("Retry nakon server greške (pokušaj %d/%d)", attempt + 1, MAX_RETRIES)
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(
                f"OpenAI API greška ({e.status_code}): {e.message}"
            ) from e

    if response is None:
        raise RuntimeError("OpenAI API nije vratio odgovor.")

    return json.loads(response.choices[0].message.content)


def extract_document(pdf_bytes: bytes) -> ExtrahiraniDokument:
    """
    Ekstrahiraj jedan PDF (narudžbenica ILI sastavnica) koristeći OpenAI native PDF input.

    Args:
        pdf_bytes: Sadržaj PDF datoteke

    Returns:
        ExtrahiraniDokument s vrstom dokumenta i stavkama
    """
    base64_pdf = base64.b64encode(pdf_bytes).decode("utf-8")

    content = [
        {"type": "text", "text": EXTRACTION_PROMPT},
        {
            "type": "file",
            "file": {
                "filename": "dokument.pdf",
                "file_data": f"data:application/pdf;base64,{base64_pdf}"
            }
        }
    ]

    result = _request_completion(content)

    stavke = [
        DokumentStavka(
            redni_broj=s["redni_broj"],
            naziv=s["naziv"],
            broj_dijela=s.get("broj_dijela", ""),
            kolicina=s["kolicina"],
            naziv_objekta=s.get("naziv_objekta", ""),
            wbs=s.get("wbs", ""),
        )
        for s in result["stavke"]
    ]

    return ExtrahiraniDokument(
        document_type=DocumentType(result["document_type"]),
        broj_narudzbe=result.get("broj_narudzbe", ""),
        broj_sklopa=result.get("broj_sklopa", ""),
        stavke=stavke,
    )


def _norm_key(value: str) -> str:
    """Normaliziraj šifru/broj sklopa za usporedbu (bez razmaka, velika slova)."""
    return re.sub(r"\s+", "", value or "").upper()


def _first_int(value: str, default: int = 1) -> int:
    """Izvuci prvi cijeli broj iz stringa količine (npr. '44 PC' -> 44)."""
    if not value:
        return default
    match = re.search(r"\d+", value)
    return int(match.group()) if match else default


def _multiply_kolicina(poz_kolicina: str, dio_kolicina: str) -> str:
    """Količina naljepnice = količina pozicije × količina dijela, jedinica KOM."""
    total = _first_int(poz_kolicina) * _first_int(dio_kolicina)
    return f"{total} KOM"


def _normalize_kom(kolicina: str) -> str:
    """Pretvori količinu u format '<broj> KOM' (za fallback iz same pozicije)."""
    return f"{_first_int(kolicina)} KOM"


def build_labels(documents: List[ExtrahiraniDokument]) -> NarudzbaData:
    """
    Poveži narudžbenice sa sastavnicama u listu artikala (naljepnica).

    Logika:
    - Pozicije iz narudžbenice(a) su izvorne stavke.
    - Ako pozicija (broj_dijela) odgovara nekoj sastavnici (broj_sklopa),
      raširi se u jednu naljepnicu po dijelu sastavnice, s množenom količinom.
    - Ako nema odgovarajuće sastavnice, naljepnica se generira iz same pozicije.
    - Ako je uploadan samo jedan dokument (narudžbenica), sve pozicije ostaju kao naljepnice.
    """
    narudzbenice = [d for d in documents if d.document_type == DocumentType.NARUDZBENICA]
    sastavnice = [d for d in documents if d.document_type == DocumentType.SASTAVNICA]

    # Indeks sastavnica po normaliziranom broju sklopa
    bom_by_sklop = {
        _norm_key(s.broj_sklopa): s
        for s in sastavnice
        if _norm_key(s.broj_sklopa)
    }

    broj_narudzbe = next((n.broj_narudzbe for n in narudzbenice if n.broj_narudzbe), "")

    # Izvorne pozicije: iz narudžbenica. Ako nema narudžbenice (npr. samo sastavnica),
    # tretiraj stavke svih dokumenata kao pozicije (fallback na staro ponašanje).
    if narudzbenice:
        pozicije = [(n, s) for n in narudzbenice for s in n.stavke]
    else:
        pozicije = [(d, s) for d in documents for s in d.stavke]

    artikli: List[Artikl] = []
    for _doc, poz in pozicije:
        bom = bom_by_sklop.get(_norm_key(poz.broj_dijela))
        if bom and bom.stavke:
            # Raširi poziciju preko svih dijelova sastavnice
            for dio in bom.stavke:
                artikli.append(Artikl(
                    redni_broj=len(artikli) + 1,
                    naziv=dio.naziv,
                    novi_broj_dijela=dio.broj_dijela,
                    stari_broj_dijela="",
                    kolicina=_multiply_kolicina(poz.kolicina, dio.kolicina),
                    naziv_objekta=poz.naziv_objekta,
                    wbs=poz.wbs,
                ))
        else:
            # Fallback: naljepnica iz same pozicije
            artikli.append(Artikl(
                redni_broj=len(artikli) + 1,
                naziv=poz.naziv,
                novi_broj_dijela=poz.broj_dijela,
                stari_broj_dijela="",
                kolicina=_normalize_kom(poz.kolicina),
                naziv_objekta=poz.naziv_objekta,
                wbs=poz.wbs,
            ))

    return NarudzbaData(broj_narudzbe=broj_narudzbe, artikli=artikli)
