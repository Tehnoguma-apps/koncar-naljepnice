import { useCallback, useState } from 'react';
import { extractFromPdf, generateLabels, type OutputFormat } from './api';
import { FileUpload } from './components/FileUpload';
import { LabelEditor } from './components/LabelEditor';
import { LabelPreview } from './components/LabelPreview';
import type { LabelData, NarudzbaData } from './types';

function getLabelKey(label: LabelData, index: number): string {
  return `${label.narudzba}-${index}-${label.naziv.slice(0, 20)}`;
}

type Step = 'upload' | 'review' | 'edit';

function App() {
  const [step, setStep] = useState<Step>('upload');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('pdf');

  const handleFilesSelect = async (files: File[]) => {
    setIsLoading(true);
    setError(null);

    try {
      const data: NarudzbaData = await extractFromPdf(files);
      
      // Convert extracted data to labels
      const newLabels: LabelData[] = data.artikli.map(artikl => ({
        naziv: artikl.naziv,
        novi_broj_dijela: artikl.novi_broj_dijela || '',
        stari_broj_dijela: artikl.stari_broj_dijela || '',
        kolicina: artikl.kolicina,
        narudzba: data.broj_narudzbe,
        account_category: '',
        naziv_objekta: artikl.naziv_objekta,
        wbs: artikl.wbs,
        datum: '',
      }));

      setLabels(newLabels);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Došlo je do greške');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLabelChange = useCallback((index: number, field: keyof LabelData, value: string) => {
    setLabels(prev => prev.map((label, i) =>
      i === index ? { ...label, [field]: value } : label
    ));
  }, []);

  const handleGenerateLabels = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateLabels(labels, outputFormat);
      
      // Convert blob to File object for better macOS compatibility
      const file = new File([result.blob], result.filename, { 
        type: result.mimeType,
        lastModified: Date.now()
      });
      
      // Create download link
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      
      // Delay cleanup to ensure download completes
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 250);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Greška pri generiranju naljepnica');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setLabels([]);
    setEditingIndex(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-zinc-900">Končar Naljepnice</h1>
              <p className="text-xs text-zinc-500">Generator QA identifikacijskih kartica</p>
            </div>
          </div>

          {step !== 'upload' && (
            <button
              onClick={handleReset}
              className="text-sm text-zinc-600 hover:text-zinc-900 flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Nova narudžba
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-3">
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Step: Upload */}
        {step === 'upload' && (
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-zinc-900 mb-2">Učitajte dokumente</h2>
              <p className="text-zinc-600">
                Učitajte PDF narudžbenicu — i po potrebi pripadajuće sastavnice — a mi ćemo
                automatski povezati pozicije i pripremiti naljepnice
              </p>
            </div>
            <FileUpload onFilesSelect={handleFilesSelect} isLoading={isLoading} />
            
            {isLoading && (
              <div className="mt-6 flex flex-col items-center gap-2 text-zinc-600">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Ekstrahiram podatke pomoću AI...</span>
                </div>
                <span className="text-xs text-zinc-400">Obrada većih dokumenata može potrajati do nekoliko minuta</span>
              </div>
            )}
          </div>
        )}

        {/* Step: Review */}
        {step === 'review' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Pregled naljepnica</h2>
                <p className="text-sm text-zinc-600">
                  Pronađeno {labels.length} artikala. Kliknite na naljepnicu za uređivanje.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Format Selector */}
                <div className="flex items-center gap-2">
                  <label htmlFor="format" className="text-sm text-zinc-600">Format:</label>
                  <select
                    id="format"
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                    className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm font-medium text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  >
                    <option value="pdf">PDF</option>
                    <option value="png">PNG (300 DPI)</option>
                  </select>
                </div>
                
                <button
                  onClick={handleGenerateLabels}
                  disabled={isGenerating || labels.length === 0}
                  className="px-6 py-3 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-900 font-semibold rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-amber-400/25"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                      Generiram...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {outputFormat === 'png' ? 'Preuzmi PNG' : 'Preuzmi PDF'}
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Labels Grid */}
              <div className="space-y-4">
                <h3 className="font-medium text-zinc-700 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  Pregled
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {labels.map((label, index) => (
                    <div
                      key={getLabelKey(label, index)}
                      onClick={() => setEditingIndex(index)}
                      className={`relative cursor-pointer transition-all hover:scale-[1.02] ${editingIndex === index ? 'ring-2 ring-amber-400 ring-offset-2 rounded-lg' : ''}`}
                    >
                      <LabelPreview label={label} index={index} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Editor */}
              <div className="space-y-4">
                <h3 className="font-medium text-zinc-700 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Uredi podatke
                </h3>
                {editingIndex !== null ? (
                  <LabelEditor
                    label={labels[editingIndex]}
                    index={editingIndex}
                    onChange={handleLabelChange}
                  />
                ) : (
                  <div className="bg-zinc-100 rounded-xl p-8 text-center text-zinc-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                    </svg>
                    <p className="text-sm">Kliknite na naljepnicu za uređivanje</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-zinc-500">
          Končar Energetski Transformatori d.o.o. — Generator QA naljepnica
        </div>
      </footer>
    </div>
  );
}

export default App;
