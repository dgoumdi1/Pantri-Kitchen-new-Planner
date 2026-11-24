import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { useInterpretVoiceIngredients, type VoiceIngredientSuggestion } from '@workspace/api-client-react';
import type { FoodCategory, FoodItem, Location } from '../lib/types';

type Props = { item?: FoodItem; onClose: () => void; onSave: (item: Omit<FoodItem, 'id'>) => void; onSaveMany?: (items: Omit<FoodItem, 'id'>[]) => void };
type Values = { name: string; quantity: string; unit: string; location: Location; expirationDate: string };
type SpeechRecognitionEventLike = Event & { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const categories: FoodCategory[] = ['Fruit', 'Vegetable', 'Dairy', 'Meat', 'Seafood', 'Grains', 'Bakery', 'Frozen', 'Condiment', 'Beverage', 'Snack', 'Other'];

export function FoodItemDialog({ item, onClose, onSave, onSaveMany }: Props) {
  const [values, setValues] = useState<Values>({
    name: item?.name ?? '',
    quantity: item ? String(item.quantity) : '',
    unit: item?.unit ?? 'pieces',
    location: item?.location ?? 'Pantry',
    expirationDate: item?.expirationDate ?? '',
  });
  const [error, setError] = useState('');
  const [voiceSupported] = useState(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'stopped'>('idle');
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [suggestions, setSuggestions] = useState<(VoiceIngredientSuggestion & { id: string })[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef('');
  const interpretVoice = useInterpretVoiceIngredients();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAndStop(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopRecognition(false);
    };
  }, [onClose]);

  const stopRecognition = (updateStatus = true) => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (updateStatus) setVoiceStatus('stopped');
  };
  const closeAndStop = () => { stopRecognition(false); onClose(); };

  const startRecognition = () => {
    if (!voiceSupported) return;
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) return;
    setVoiceError('');
    setSuggestions([]);
    setConfirmed(false);
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      let next = '';
      for (let index = 0; index < event.results.length; index += 1) {
        next += event.results[index][0].transcript;
      }
      transcriptRef.current = next.trim();
      setTranscript(transcriptRef.current);
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Microphone permission was denied. Allow microphone access or enter the items manually.',
        'service-not-allowed': 'Speech recognition is unavailable in this browser session. Enter items manually.',
        'no-speech': 'No speech was detected. Try again or use manual entry.',
        'audio-capture': 'A microphone could not be found or accessed. Check your microphone and try again.',
        'network': 'The recognition service could not be reached. Try again or use manual entry.',
        'aborted': 'Listening was stopped.',
      };
      setVoiceError(messages[event.error] ?? 'Speech recognition failed. Enter the items manually.');
      setVoiceStatus('idle');
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        setVoiceStatus('stopped');
        recognitionRef.current = null;
      }
    };
    recognitionRef.current = recognition;
    setTranscript('');
    transcriptRef.current = '';
    setVoiceStatus('listening');
    try { recognition.start(); } catch {
      setVoiceStatus('idle');
      setVoiceError('Speech recognition could not start. Use manual entry or try again.');
      recognitionRef.current = null;
    }
  };

  const update = (key: keyof Values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.name.trim()) { setError('Please add a food name.'); return; }
    if (!values.quantity || Number(values.quantity) <= 0) { setError('Quantity must be greater than zero.'); return; }
    onSave({ name: values.name.trim(), quantity: Number(values.quantity), unit: values.unit, location: values.location, expirationDate: values.expirationDate });
  };

  const interpretTranscript = async () => {
    const reviewed = transcript.trim();
    if (!reviewed || interpretVoice.isPending) return;
    stopRecognition(true);
    setVoiceError('');
    setConfirmed(false);
    interpretVoice.mutate({ data: { transcript: reviewed } }, {
      onSuccess: (analysis) => setSuggestions(analysis.items.map((item) => ({ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }))),
      onError: () => setVoiceError('Pantri AI could not interpret the transcript. Keep the text and use manual entry, or try again.'),
    });
  };

  const localFallback = () => {
    const text = transcript.trim();
    if (!text) { setVoiceError('Enter or speak an ingredient name before using the local suggestion.'); return; }
    const lower = text.toLowerCase();
    const known: [RegExp, string, FoodCategory, Location][] = [
      [/rice|grain|oats/, 'Rice', 'Grains', 'Pantry'],
      [/milk|yogurt|cheese/, 'Milk', 'Dairy', 'Fridge'],
      [/frozen peas|peas/, 'Peas', 'Vegetable', 'Freezer'],
      [/bread/, 'Bread', 'Bakery', 'Pantry'],
      [/egg/, 'Eggs', 'Dairy', 'Fridge'],
    ];
    const match = known.find(([pattern]) => pattern.test(lower));
    if (!match) { setSuggestions([]); setVoiceError('No local suggestion matched. The transcript is kept for manual review.'); return; }
    const [, name, category, location] = match;
    setSuggestions([{ id: `${Date.now()}-local`, name, quantity: null, unit: null, category, location, clarificationNeeded: 'Local lookup only. Confirm the name, quantity, unit, category, and storage location.' }]);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAndStop(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="food-dialog-title" data-testid="dialog-food-item">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Your kitchen, in good order</div>
            <h2 id="food-dialog-title">{item ? 'Edit food item' : 'Add to your kitchen'}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={closeAndStop} data-testid="button-close-food-dialog"><X size={19} /></button>
        </div>
        {!item && (
          <div style={{ marginBottom: 16, padding: 14, border: '1px solid #e5e2d6', borderRadius: 14, background: '#faf9f3' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="button button-outline" onClick={voiceStatus === 'listening' ? () => stopRecognition(true) : startRecognition} disabled={!voiceSupported} aria-label={voiceStatus === 'listening' ? 'Stop voice input' : 'Add by voice'} data-testid="button-add-by-voice">
                {voiceStatus === 'listening' ? <Square size={15} /> : <Mic size={15} />}
                {voiceStatus === 'listening' ? 'Stop' : 'Add by voice'}
              </button>
              {voiceStatus === 'listening' && <button type="button" className="button button-outline" onClick={() => { stopRecognition(true); setTranscript(''); transcriptRef.current = ''; setSuggestions([]); setVoiceError('Voice input canceled. No items were added.'); }} data-testid="button-cancel-voice">Cancel</button>}
              {voiceStatus === 'listening' && <span className="form-error" role="status">Listening…</span>}
            </div>
            {!voiceSupported && <p className="form-error" role="alert">Speech recognition is not supported in this browser. You can enter ingredients manually below.</p>}
            {voiceSupported && <p className="field-hint" style={{ marginTop: 10 }}>
              Browser speech recognition may send audio to the browser or operating-system recognition provider. It is not guaranteed to remain local.
              The reviewed transcript is sent to Pantri AI only when you choose “Interpret with Pantri AI.”
            </p>}
            <label htmlFor="voice-transcript" style={{ display: 'block', marginTop: 10, fontSize: 12, fontWeight: 700 }}>Editable voice transcript</label>
            <textarea id="voice-transcript" className="pa-textarea" value={transcript} onChange={(event) => { setTranscript(event.target.value); transcriptRef.current = event.target.value; }} placeholder="Say or type ingredients, quantities, units, and storage locations…" maxLength={2000} data-testid="input-voice-transcript" style={{ width: '100%', minHeight: 78, marginTop: 6 }} />
            {transcript.trim() && <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="button button-primary button-small" onClick={() => void interpretTranscript()} disabled={interpretVoice.isPending} data-testid="button-interpret-voice">{interpretVoice.isPending ? 'Interpreting…' : 'Interpret with Pantri AI'}</button>
              <button type="button" className="button button-outline button-small" onClick={localFallback} data-testid="button-local-voice-fallback">Use local lookup</button>
            </div>}
            {voiceError && <p className="form-error" role="alert" data-testid="status-voice-error">{voiceError}</p>}
            {suggestions.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <strong style={{ fontSize: 13 }}>Review interpreted items</strong>
                {suggestions.map((suggestion, index) => (
                  <div key={suggestion.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr .7fr .7fr 1fr 1fr auto', gap: 7, alignItems: 'end', marginTop: 8 }} data-testid={`row-voice-suggestion-${index}`}>
                    <label className="field"><span>Name</span><input value={suggestion.name} onChange={(event) => setSuggestions((current) => current.map((row) => row.id === suggestion.id ? { ...row, name: event.target.value } : row))} /></label>
                    <label className="field"><span>Quantity</span><input type="number" min="0" step="any" value={suggestion.quantity ?? ''} onChange={(event) => setSuggestions((current) => current.map((row) => row.id === suggestion.id ? { ...row, quantity: event.target.value === '' ? null : Number(event.target.value) } : row))} /></label>
                    <label className="field"><span>Unit</span><input value={suggestion.unit ?? ''} onChange={(event) => setSuggestions((current) => current.map((row) => row.id === suggestion.id ? { ...row, unit: event.target.value || null } : row))} /></label>
                    <label className="field"><span>Category</span><select value={suggestion.category} onChange={(event) => setSuggestions((current) => current.map((row) => row.id === suggestion.id ? { ...row, category: event.target.value as FoodCategory } : row))}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                    <label className="field"><span>Location</span><select value={suggestion.location} onChange={(event) => setSuggestions((current) => current.map((row) => row.id === suggestion.id ? { ...row, location: event.target.value as Location } : row))}><option>Pantry</option><option>Fridge</option><option>Freezer</option></select></label>
                    <button type="button" className="icon-button" aria-label={`Remove ${suggestion.name}`} onClick={() => setSuggestions((current) => current.filter((row) => row.id !== suggestion.id))}><X size={15} /></button>
                    {suggestion.clarificationNeeded && <p className="field-hint" style={{ gridColumn: '1/-1', margin: 0 }}>{suggestion.clarificationNeeded}</p>}
                  </div>
                ))}
                <label style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 12 }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed these items and locations before adding them.</label>
                <button type="button" className="button button-primary" style={{ marginTop: 12 }} disabled={voiceSaving || !confirmed || suggestions.length === 0 || suggestions.some((item) => !item.name.trim() || item.quantity == null || item.quantity <= 0 || !item.unit?.trim())} onClick={() => {
                  if (!voiceSaving && onSaveMany && confirmed && suggestions.length > 0) {
                    setVoiceSaving(true);
                    onSaveMany(suggestions.map((item) => ({
                      name: item.name.trim(),
                      quantity: item.quantity ?? 0,
                      unit: item.unit?.trim() ?? '',
                      location: item.location,
                      expirationDate: '',
                      category: item.category,
                    })));
                    setConfirmed(false);
                  }
                }} data-testid="button-confirm-voice-items">Confirm and add</button>
              </div>
            )}
          </div>
        )}
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="food-name">Food name *</label>
              <input id="food-name" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Baby spinach" required data-testid="input-food-name" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="food-quantity">Quantity *</label>
              <input id="food-quantity" type="number" min="0.01" step="any" value={values.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="1" required data-testid="input-food-quantity" />
            </div>
            <div className="field">
              <label htmlFor="food-unit">Unit</label>
              <select id="food-unit" value={values.unit} onChange={(event) => update('unit', event.target.value)} data-testid="select-food-unit">
                {['pieces', 'g', 'kg', 'ml', 'liters', 'bag', 'bunch', 'cans', 'pack'].map((unit) => <option key={unit}>{unit}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="food-location">Storage location</label>
              <select id="food-location" value={values.location} onChange={(event) => update('location', event.target.value as Location)} data-testid="select-food-location">
                <option>Pantry</option><option>Fridge</option><option>Freezer</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="food-expiration">Expiration date</label>
              <input id="food-expiration" type="date" value={values.expirationDate} onChange={(event) => update('expirationDate', event.target.value)} data-testid="input-food-expiration" />
            </div>
          </div>
          {error && <p className="form-error" role="alert" data-testid="status-food-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-outline" onClick={closeAndStop} data-testid="button-cancel-food">Cancel</button>
            <button type="submit" className="button button-primary" data-testid="button-save-food">{item ? 'Save changes' : 'Add item'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
