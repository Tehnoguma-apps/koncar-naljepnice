import { useCallback, useState } from 'react';

const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB
const MAX_FILES = 10;

interface FileUploadProps {
  onFilesSelect: (files: File[]) => void;
  isLoading: boolean;
}

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({ onFilesSelect, isLoading }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setFileError(null);
    setFiles((prev) => {
      const next = [...prev];
      for (const file of Array.from(incoming)) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          setFileError('Samo PDF datoteke su podržane.');
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          setFileError(`Datoteka "${file.name}" je prevelika (${formatSize(file.size)}). Maksimum je 30MB.`);
          continue;
        }
        // Izbjegni duplikate (po imenu + veličini)
        if (next.some((f) => f.name === file.name && f.size === file.size)) {
          continue;
        }
        next.push(file);
      }
      if (next.length > MAX_FILES) {
        setFileError(`Maksimalno ${MAX_FILES} datoteka.`);
        return next.slice(0, MAX_FILES);
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Reset da se isti fajl može ponovno odabrati nakon uklanjanja
    e.target.value = '';
  }, [addFiles]);

  const handleSubmit = useCallback(() => {
    if (files.length > 0) {
      onFilesSelect(files);
    }
  }, [files, onFilesSelect]);

  return (
    <div className="space-y-4">
      <div
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-2xl p-12 transition-all duration-300 cursor-pointer
          ${isDragging
            ? 'border-amber-400 bg-amber-50 scale-[1.02]'
            : 'border-zinc-300 hover:border-amber-400 hover:bg-amber-50/50'
          }
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isLoading}
        />

        <div className="flex flex-col items-center gap-4 text-center">
          <div className={`
            w-16 h-16 rounded-2xl flex items-center justify-center transition-colors
            ${isDragging ? 'bg-amber-400' : 'bg-zinc-100'}
          `}>
            <svg
              className={`w-8 h-8 ${isDragging ? 'text-white' : 'text-zinc-500'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          <div>
            <p className="text-lg font-medium text-zinc-800">
              {isLoading ? 'Obrađujem...' : 'Povucite PDF datoteke ovdje'}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              ili kliknite za odabir (narudžbenica + sastavnice)
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Više PDF datoteka (max {MAX_FILES} × 30MB)</span>
          </div>

          {fileError && (
            <div className="mt-2 text-sm text-red-600 font-medium">
              {fileError}
            </div>
          )}
        </div>
      </div>

      {/* Lista odabranih datoteka */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-600">
            Odabrane datoteke ({files.length})
          </p>
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}`}
                className="flex items-center gap-3 bg-white border border-zinc-200 rounded-lg px-3 py-2"
              >
                <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="flex-1 text-sm text-zinc-700 truncate" title={file.name}>{file.name}</span>
                <span className="text-xs text-zinc-400 shrink-0">{formatSize(file.size)}</span>
                {!isLoading && (
                  <button
                    onClick={() => removeFile(index)}
                    className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
                    aria-label="Ukloni datoteku"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>

          <button
            onClick={handleSubmit}
            disabled={isLoading || files.length === 0}
            className="w-full mt-2 px-6 py-3 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-900 font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-400/25"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                Ekstrahiram...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Ekstrahiraj podatke
              </>
            )}
          </button>
          <p className="text-xs text-zinc-400 text-center">
            {files.length > 1
              ? 'Pozicije iz narudžbenice će se povezati sa sastavnicama.'
              : 'Jedan dokument — sve pozicije postaju naljepnice.'}
          </p>
        </div>
      )}
    </div>
  );
}
