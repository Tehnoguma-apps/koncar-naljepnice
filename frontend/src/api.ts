import type { LabelData, NarudzbaData } from "./types";

// Use environment variable for API URL, fallback to localhost for development
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const API_TIMEOUT = 300_000; // 5 minutes - large PDFs with many pages need more time

export type OutputFormat = 'pdf' | 'png';

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

function handleFetchError(err: unknown, operation: string): never {
  if (err instanceof DOMException && err.name === 'AbortError') {
    throw new Error(`Zahtjev je istekao (timeout). ${operation} traje predugo — pokušajte s manjim dokumentom.`);
  }
  if (err instanceof TypeError && err.message.includes('fetch')) {
    throw new Error('Nije moguće spojiti se na server. Provjerite mrežnu vezu.');
  }
  throw err;
}

export async function extractFromPdf(files: File[]): Promise<NarudzbaData> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/extract`, {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    handleFetchError(err, 'Ekstrakcija podataka');
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Greška pri ekstrakciji podataka iz PDF-a');
  }

  return response.json();
}

export interface GenerateLabelsResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

export async function generateLabels(
  labels: LabelData[],
  format: OutputFormat = 'pdf'
): Promise<GenerateLabelsResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/generate-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ labels, format }),
    });
  } catch (err) {
    handleFetchError(err, 'Generiranje naljepnica');
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Greška pri generiranju naljepnica');
  }

  const arrayBuffer = await response.arrayBuffer();

  if (format === 'png') {
    return {
      blob: new Blob([arrayBuffer], { type: 'application/zip' }),
      filename: 'naljepnice.zip',
      mimeType: 'application/zip'
    };
  } else {
    return {
      blob: new Blob([arrayBuffer], { type: 'application/pdf' }),
      filename: 'naljepnice.pdf',
      mimeType: 'application/pdf'
    };
  }
}

// Legacy function for backwards compatibility
export async function generatePdf(labels: LabelData[]): Promise<Blob> {
  const result = await generateLabels(labels, 'pdf');
  return result.blob;
}
