import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowUp, Check, ChefHat, Clock3, ImagePlus, LoaderCircle, MessageCircle, Plus, ReceiptText, Sparkles, Trash2, X } from 'lucide-react';
import {
  getGetAssistantHistoryQueryKey,
  useAnalyzeKitchenImage,
  useClearAssistantHistory,
  useGenerateAssistantRecipe,
  useGetAssistantHistory,
  useSendAssistantMessage,
  type AccountData,
  type AssistantAction,
  type AssistantHistory,
  type GeneratedRecipe,
  type KitchenImageAnalysis,
} from '@workspace/api-client-react';

type AssistantPageProps = {
  data: AccountData;
  onApplyAction: (action: AssistantAction) => Promise<void>;
  onSaveRecipe: (recipe: GeneratedRecipe) => Promise<void>;
  onManualEntry: () => void;
  userId: string;
};

type LocalMessage = { id: string; role: 'user' | 'assistant'; content: string };
type ScanDraft = KitchenImageAnalysis['items'][number] & { selected: boolean; duplicate: boolean };
type ScanMode = 'receipt' | 'food_photo';

const consentCopy = 'I understand that free-tier requests and uploaded image content are sent to Google and may be used to improve Google’s products.';
const locations: AssistantAction['location'][] = ['Pantry', 'Fridge', 'Freezer'];
const normalizeName = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const getErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Something went wrong. Please try again.';
  const e = error as { message?: string; data?: { message?: string; error?: string }; response?: { data?: { message?: string; error?: string } } };
  return e.response?.data?.message || e.response?.data?.error || e.data?.message || e.data?.error || e.message || 'Something went wrong. Please try again.';
};
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function AssistantPage({ data, onApplyAction, onSaveRecipe, onManualEntry, userId }: AssistantPageProps) {
  const queryClient = useQueryClient();
  const historyKey = getGetAssistantHistoryQueryKey();
  const historyQuery = useGetAssistantHistory({ query: { queryKey: historyKey } });
  const clearHistory = useClearAssistantHistory();
  const sendMessage = useSendAssistantMessage();
  const generateRecipe = useGenerateAssistantRecipe();
  const analyzeImage = useAnalyzeKitchenImage();
  const fileInput = useRef<HTMLInputElement>(null);
  const consentStorageKey = `pantri-google-ai-consent:${userId}`;
  const [consented, setConsented] = useState(() => sessionStorage.getItem(consentStorageKey) === 'accepted');
  const [message, setMessage] = useState('');
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<AssistantAction[]>([]);
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [scanMode, setScanMode] = useState<ScanMode>('receipt');
  const [scanDrafts, setScanDrafts] = useState<ScanDraft[]>([]);
  const [scanReviewed, setScanReviewed] = useState(false);
  const [scanNotes, setScanNotes] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recipePrompt, setRecipePrompt] = useState('');
  const [servings, setServings] = useState('2');
  const [timeLimit, setTimeLimit] = useState('30');
  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null);
  const [recipeSaveState, setRecipeSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [recipeSaveBusy, setRecipeSaveBusy] = useState(false);
  const [recipeSaveError, setRecipeSaveError] = useState('');
  const [toast, setToast] = useState('');

  const inventoryNames = useMemo(() => new Set(data.inventory.map((item) => normalizeName(item.name))), [data.inventory]);
  const historyMessages = historyQuery.data?.messages ?? [];

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = message.trim();
    if (!clean || !consented || sendMessage.isPending) return;
    setMessage('');
    setActionError('');
    setPendingActions([]);
    const userEntry: LocalMessage = { id: makeId(), role: 'user', content: clean };
    setLocalMessages((current) => [...current, userEntry]);
    sendMessage.mutate({ data: { message: clean } }, {
      onSuccess: (reply) => {
        const createdAt = new Date().toISOString();
        queryClient.setQueryData<AssistantHistory>(historyKey, (old) => ({
          messages: [
            ...(old?.messages ?? []),
            { id: userEntry.id, role: 'user' as const, content: clean, createdAt },
            { id: makeId(), role: 'assistant' as const, content: reply.answer, createdAt },
          ],
        }));
        setLocalMessages((current) => current.filter((entry) => entry.id !== userEntry.id));
        setPendingActions(reply.actions ?? []);
      },
    });
  };

  const confirmAction = async (action: AssistantAction, index: number) => {
    setActionBusy(index);
    setActionError('');
    try {
      await onApplyAction(action);
      setPendingActions((current) => current.filter((_, i) => i !== index));
      setToast(`${action.name} added to ${action.type === 'add_shopping' ? 'your shopping list' : 'your kitchen'}.`);
      window.setTimeout(() => setToast(''), 2600);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setActionBusy(null);
    }
  };

  const submitRecipe = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = [
      recipePrompt.trim(),
      `Make a structured recipe for ${servings} servings.`,
      `Keep preparation and cooking time to about ${timeLimit} minutes.`,
      `Use these ingredients when suitable: ${data.inventory.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ') || 'no inventory is currently recorded'}.`,
      `Respect these dietary preferences: ${data.preferences.dietaryFilters.join(', ') || 'none specified'}.`,
      `Measurement preference: ${data.preferences.units}.`,
    ].join(' ');
    if (!consented || !recipePrompt.trim()) return;
    setRecipe(null);
    setRecipeSaveState('idle');
    setRecipeSaveError('');
    generateRecipe.mutate({ data: { prompt } }, {
      onSuccess: (generated) => setRecipe(generated),
    });
  };

  const analyzeSelectedFile = async (file: File) => {
    setScanBusy(true);
    setScanError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('The selected image could not be read.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      if (!base64) throw new Error('The selected image could not be read.');
      analyzeImage.mutate({ data: { imageBase64: base64, mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', mode: scanMode } }, {
        onSuccess: (analysis) => {
          setScanNotes(analysis.notes || '');
          setScanReviewed(false);
          setScanDrafts((analysis.items ?? []).map((item) => {
            const duplicate = inventoryNames.has(normalizeName(item.name));
            return { ...item, selected: !duplicate, duplicate };
          }));
          setSelectedFile(null);
          setScanBusy(false);
        },
        onError: (error) => {
          setScanError(getErrorMessage(error));
          setScanBusy(false);
        },
      });
    } catch (error) {
      setScanError(getErrorMessage(error));
      setScanBusy(false);
    }
  };

  const onImageSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setScanError('');
    setScanDrafts([]);
    setScanReviewed(false);
    setScanNotes('');
    if (file.size > 5 * 1024 * 1024) {
      setSelectedFile(null);
      setScanError('That image is larger than 5 MB. Choose a smaller photo or receipt.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setSelectedFile(null);
      setScanError('This format is not supported. Choose a JPEG, PNG, or WebP image.');
      return;
    }
    setSelectedFile(file);
    setScanError('');
  };

  const updateScanDraft = (index: number, field: keyof ScanDraft, value: string | number | boolean) => {
    setScanDrafts((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const addReviewedScanItems = async () => {
    const selected = scanDrafts.filter((item) => item.selected && item.name.trim());
    if (!selected.length || !scanReviewed) return;
    setScanBusy(true);
    setScanError('');
    try {
      for (const item of selected) {
        await onApplyAction({
          type: scanMode === 'receipt' ? 'add_shopping' : 'add_inventory',
          name: item.name.trim(),
          quantity: Number(item.quantity) || 1,
          unit: item.unit.trim(),
          location: item.location,
        });
      }
      setScanDrafts((current) => current.filter((item) => !item.selected));
      setToast(`${selected.length} reviewed ${selected.length === 1 ? 'item' : 'items'} added.`);
      window.setTimeout(() => setToast(''), 2600);
    } catch (error) {
      setScanError(getErrorMessage(error));
    } finally {
      setScanBusy(false);
    }
  };

  const saveGeneratedRecipe = async () => {
    if (!recipe || recipeSaveBusy) return;
    setRecipeSaveBusy(true);
    setRecipeSaveError('');
    try {
      await onSaveRecipe(recipe);
      setRecipeSaveState('saved');
    } catch (error) {
      setRecipeSaveError(getErrorMessage(error));
      setRecipeSaveState('error');
    } finally {
      setRecipeSaveBusy(false);
    }
  };

  const clearChatHistory = () => {
    if (!window.confirm('Clear your saved assistant conversation? This cannot be undone.')) return;
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(historyKey, { messages: [] });
        setLocalMessages([]);
        setPendingActions([]);
      },
    });
  };

  const historyErrorText = historyQuery.error ? getErrorMessage(historyQuery.error) : '';
  return (
    <main className="pantri-assistant" data-testid="page-assistant">
      <style>{`
        .pantri-assistant{--pa-ink:#30453a;--pa-muted:#78877c;--pa-line:#e8e4d8;--pa-paper:#fffdf8;--pa-green:#397456;--pa-sage:#eaf1e8;--pa-amber:#a97749;max-width:1120px;margin:0 auto;padding:20px 0 44px;color:var(--pa-ink)}
        .pa-hero{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:22px;align-items:center;margin:2px 0 23px;padding:23px 26px;border:1px solid #e9e3d5;border-radius:22px;background:linear-gradient(115deg,#f7f1e5 0%,#f3f3e9 55%,#eaf1e8 100%);overflow:hidden}
        .pa-kicker{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:#748679}
        .pa-hero h1{font:600 clamp(32px,4vw,44px)/1.05 var(--app-font-serif,Georgia,serif);letter-spacing:-.8px;margin:9px 0;color:#2d4338}
        .pa-hero p{color:#718176;margin:0;max-width:590px;font-size:14px;line-height:1.55}
        .pa-hero-aside{justify-self:end;max-width:225px;padding:14px 16px;border-radius:16px;background:#fffdf8ad;border:1px solid #ffffffb0;color:#66786b;font-size:12px;line-height:1.5}
        .pa-hero-aside strong{display:block;color:#47634f;margin-bottom:4px;font-size:13px}
        .pa-consent{display:flex;align-items:flex-start;gap:11px;padding:13px 15px;margin-bottom:19px;border:1px solid #eadfcb;border-radius:14px;background:#fbf4e8;color:#6d604d;font-size:12px;line-height:1.5}
        .pa-consent input{width:17px;height:17px;margin:1px 0 0;accent-color:var(--pa-green);flex:none}
        .pa-consent strong{color:#69553d}
        .pa-grid{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(320px,.88fr);gap:17px;align-items:start}
        .pa-col{display:grid;gap:17px;min-width:0}
        .pa-panel{background:var(--pa-paper);border:1px solid var(--pa-line);border-radius:20px;box-shadow:0 7px 22px rgba(67,75,55,.035);overflow:hidden}
        .pa-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 19px 13px}
        .pa-title-wrap{display:flex;align-items:center;gap:10px}
        .pa-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:12px;background:var(--pa-sage);color:var(--pa-green);flex:none}
        .pa-panel h2{font:600 20px/1.2 var(--app-font-serif,Georgia,serif);margin:0;color:#33483b}
        .pa-subhead{font-size:11px;color:#849087;margin-top:3px}
        .pa-link-button{border:0;background:transparent;color:#829087;font-size:11px;font-weight:700;padding:7px 4px;display:inline-flex;align-items:center;gap:5px}
        .pa-link-button:hover{color:#a34f43}
        .pa-chat-log{max-height:340px;overflow:auto;padding:4px 18px 12px;display:grid;gap:10px}
        .pa-message{max-width:91%;padding:11px 13px;border-radius:14px;font-size:13px;line-height:1.55;white-space:pre-wrap}
        .pa-message.user{margin-left:auto;background:#e8f0e6;color:#3f6149;border-bottom-right-radius:5px}
        .pa-message.assistant{background:#f4f1e8;color:#536257;border-bottom-left-radius:5px}
        .pa-history-empty{padding:19px 17px;text-align:center;color:#849087;font-size:12px;line-height:1.6;background:#faf9f4;border-radius:14px}
        .pa-history-empty strong{display:block;color:#52695a;font-size:13px;margin-bottom:3px}
        .pa-action-preview{margin:0 18px 12px;padding:13px;border-radius:14px;background:#f8f4ea;border:1px solid #eee4cf}
        .pa-preview-title{font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:#91734e;margin-bottom:9px}
        .pa-action-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #ede5d6;font-size:12px}
        .pa-action-row:first-of-type{border-top:0}
        .pa-action-row span:last-child{color:#819086;text-align:right}
        .pa-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:11px}
        .pa-form{padding:0 18px 17px}
        .pa-compose{display:flex;align-items:flex-end;gap:9px;padding:9px;border:1px solid #e4e4d9;border-radius:15px;background:#fffefa}
        .pa-compose textarea{resize:vertical;min-height:42px;max-height:120px;flex:1;min-width:0;border:0;background:transparent;outline:none;padding:9px 6px;color:#34473c;font:13px/1.4 var(--app-font-sans, sans-serif)}
        .pa-compose textarea::placeholder{color:#a0aaa1}
        .pa-send{width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:12px;background:#397456;color:#fffdf8}
        .pa-send:disabled{opacity:.45;cursor:not-allowed}
        .pa-note{padding:0 18px 14px;color:#879288;font-size:10px;line-height:1.45}
        .pa-section-body{padding:0 18px 18px}
        .pa-input,.pa-select{width:100%;height:41px;border:1px solid #e2e2d8;border-radius:10px;padding:0 11px;background:#fffefa;color:#34473c;font-size:12px;outline:none}
        .pa-input:focus,.pa-select:focus,.pa-textarea:focus{border-color:#7fa28a;box-shadow:0 0 0 3px #7fa28a20}
        .pa-textarea{width:100%;min-height:78px;resize:vertical;border:1px solid #e2e2d8;border-radius:11px;padding:10px 11px;background:#fffefa;color:#34473c;font:12px/1.45 var(--app-font-sans,sans-serif);outline:none}
        .pa-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .pa-field{display:grid;gap:6px;min-width:0}
        .pa-field.full{grid-column:1/-1}
        .pa-field label{font-size:11px;color:#627367;font-weight:700}
        .pa-field-hint{font-size:10px;color:#949d95}
        .pa-button{min-height:37px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 13px;border:0;border-radius:10px;background:#397456;color:#fffdf8;font-size:12px;font-weight:700;transition:transform .16s,background .16s}
        .pa-button:hover:not(:disabled){transform:translateY(-1px);background:#2e634b}
        .pa-button:disabled{opacity:.48;cursor:not-allowed}
        .pa-button.secondary{background:#eaf1e8;color:#416a50}
        .pa-button.outline{background:#fffdf8;color:#53705d;border:1px solid #dfe6dc}
        .pa-button.quiet{background:transparent;color:#758279;border:1px solid #e4e5dc}
        .pa-button-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        .pa-recipe-result{margin-top:15px;padding:15px;border:1px solid #e6e7da;border-radius:15px;background:#fbfaf4}
        .pa-recipe-result h3{font:600 21px/1.2 var(--app-font-serif,Georgia,serif);margin:0 0 8px;color:#32483a}
        .pa-recipe-meta{display:flex;gap:10px;flex-wrap:wrap;color:#718176;font-size:10px;margin-bottom:13px}
        .pa-recipe-meta span{display:inline-flex;align-items:center;gap:4px}
        .pa-recipe-columns{display:grid;grid-template-columns:.95fr 1.05fr;gap:14px}
        .pa-recipe-result h4{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#8a927e;margin:0 0 7px}
        .pa-ingredient{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #eeece3;padding:6px 0;font-size:11px;color:#596b5e}
        .pa-ingredient span:first-child{font-weight:600}
        .pa-instructions{padding-left:18px;margin:0;color:#68776b;font-size:11px;line-height:1.55}
        .pa-instructions li{padding:0 0 5px 2px}
        .pa-upload-box{padding:15px;border-radius:15px;background:#f5f4ec;border:1px dashed #d5dccc}
        .pa-mode-row{display:flex;gap:7px;margin-bottom:12px}
        .pa-mode{flex:1;min-height:35px;border:1px solid #e0e4d9;border-radius:10px;background:#fffdf8;color:#728077;display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;font-weight:700}
        .pa-mode.active{background:#e8f0e6;border-color:#cddfce;color:#3e6d50}
        .pa-upload-info{font-size:11px;line-height:1.5;color:#748176;margin:0 0 12px}
        .pa-scan-summary{font-size:11px;color:#748176;line-height:1.5;margin:11px 0}
        .pa-candidates{display:grid;gap:8px;margin-top:10px}
        .pa-candidate{padding:10px;border:1px solid #e8e5db;background:#fffefa;border-radius:12px}
        .pa-candidate.duplicate{border-color:#ecddc8;background:#fcf7ee}
        .pa-candidate-top{display:flex;align-items:center;gap:9px}
        .pa-candidate-top input{accent-color:#397456;width:16px;height:16px}
        .pa-candidate-name{flex:1;min-width:0;font-size:12px;font-weight:700;color:#485e4e}
        .pa-confidence{font-size:10px;color:#819086;white-space:nowrap}
        .pa-candidate-fields{display:grid;grid-template-columns:minmax(0,1.3fr) 70px 80px 100px;gap:6px;margin-top:8px}
        .pa-candidate-fields .pa-input,.pa-candidate-fields .pa-select{height:34px;padding:0 7px;font-size:10px}
        .pa-candidate-note{font-size:10px;color:#a0784d;margin:7px 0 0 25px;line-height:1.4}
        .pa-error{display:flex;align-items:flex-start;gap:7px;margin:10px 0 0;padding:10px 11px;border-radius:11px;background:#fbebe7;color:#a1483d;font-size:11px;line-height:1.45}
        .pa-error svg{flex:none;margin-top:1px}
        .pa-status{margin-top:9px;color:#5e815f;font-size:11px;font-weight:700}
        .pa-skeleton{height:45px;margin:6px 0;border-radius:13px;background:#f1f0e9;animation:pa-shimmer 1.25s ease-in-out infinite alternate}
        @keyframes pa-shimmer{to{opacity:.52}}
        .pa-toast{position:fixed;right:22px;bottom:22px;z-index:90;padding:12px 16px;border-radius:12px;background:#315f4a;color:#fffdf8;font-size:12px;box-shadow:0 7px 23px #27433235}
        @media(max-width:800px){.pantri-assistant{padding-top:8px}.pa-hero{grid-template-columns:1fr;padding:20px}.pa-hero-aside{justify-self:start;max-width:none}.pa-grid{grid-template-columns:1fr}.pa-col{gap:14px}}
        @media(max-width:540px){.pa-hero{padding:18px;border-radius:17px}.pa-panel{border-radius:17px}.pa-panel-head{padding:15px 14px 11px}.pa-section-body,.pa-form{padding-left:14px;padding-right:14px}.pa-chat-log{padding-left:14px;padding-right:14px}.pa-action-preview{margin-left:14px;margin-right:14px}.pa-candidate-fields{grid-template-columns:1fr 62px 75px}.pa-candidate-fields .pa-select{grid-column:1/-1}.pa-recipe-columns{grid-template-columns:1fr}.pa-fields{grid-template-columns:1fr 1fr}.pa-message{max-width:96%}}
      `}</style>
      <header className="pa-hero">
        <div>
          <div className="pa-kicker">Your kitchen, a little easier</div>
          <h1>Good things start here.</h1>
          <p>Ask what to cook, shape a recipe around what you have, or bring a receipt and food photo into your kitchen notes.</p>
        </div>
        <aside className="pa-hero-aside"><strong>A helpful hand, not a black box</strong>Suggestions never change your kitchen until you choose what to apply. Images are sent to Google for analysis and are not retained by Pantri.</aside>
      </header>

      <label className="pa-consent" htmlFor="assistant-data-consent" data-testid="label-assistant-consent">
        <input id="assistant-data-consent" type="checkbox" checked={consented} onChange={(event) => {
          const accepted = event.target.checked;
          setConsented(accepted);
          if (accepted) sessionStorage.setItem(consentStorageKey, 'accepted');
          else sessionStorage.removeItem(consentStorageKey);
        }} data-testid="checkbox-assistant-consent" />
        <span><strong>Before you ask Pantri’s assistant:</strong> {consentCopy} Uploaded images are not retained by Pantri. You can use manual entry instead at any time.</span>
      </label>

      <div className="pa-grid" data-testid={`assistant-user-${userId}`}>
        <div className="pa-col">
          <section className="pa-panel" aria-labelledby="pa-chat-title">
            <div className="pa-panel-head">
              <div className="pa-title-wrap"><span className="pa-icon"><MessageCircle size={17} /></span><div><h2 id="pa-chat-title">Kitchen chat</h2><div className="pa-subhead">A practical answer, based on what’s around</div></div></div>
              <button className="pa-link-button" onClick={clearChatHistory} disabled={clearHistory.isPending || (!historyMessages.length && !localMessages.length)} aria-label="Clear chat history" data-testid="button-clear-assistant-history"><Trash2 size={13} /> Clear</button>
            </div>
            <div className="pa-chat-log" role="log" aria-live="polite" aria-label="Assistant conversation" data-testid="list-assistant-history">
              {historyQuery.isLoading && <><div className="pa-skeleton" /><div className="pa-skeleton" /></>}
              {historyQuery.isError && <div className="pa-error" role="alert"><AlertCircle size={15} /> Couldn’t load chat history. {historyErrorText}<button className="pa-link-button" onClick={() => void historyQuery.refetch()} data-testid="button-retry-assistant-history">Try again</button></div>}
              {!historyQuery.isLoading && !historyQuery.isError && historyMessages.length === 0 && localMessages.length === 0 && <div className="pa-history-empty"><strong>A good place to begin</strong>Try “What can I make with chickpeas and spinach?” or ask how to use something before it goes.</div>}
              {historyMessages.map((entry) => <div key={`history-${entry.id}`} className={`pa-message ${entry.role}`} data-testid={`message-history-${entry.id}`}>{entry.content}</div>)}
              {localMessages.map((entry) => <div key={entry.id} className={`pa-message ${entry.role}`} data-testid={`message-live-${entry.id}`}>{entry.content}</div>)}
              {sendMessage.isPending && <div className="pa-message assistant" aria-label="Assistant is thinking"><LoaderCircle size={14} className="pa-inline-spin" /> Thinking through your kitchen…</div>}
            </div>
            {pendingActions.length > 0 && <div className="pa-action-preview" data-testid="assistant-action-preview">
              <div className="pa-preview-title">Suggested changes · nothing added yet</div>
              {pendingActions.map((action, index) => <div className="pa-action-row" key={`${action.type}-${action.name}-${index}`} data-testid={`preview-action-${index}`}><strong>{action.name}</strong><span>{action.quantity} {action.unit} · {action.type === 'add_shopping' ? 'Shopping list' : action.location}</span></div>)}
              <div className="pa-actions"><button className="pa-button quiet" onClick={() => setPendingActions([])} data-testid="button-cancel-assistant-actions"><X size={14} /> Cancel</button>{pendingActions.map((action, index) => <button key={`confirm-${index}`} className="pa-button secondary" onClick={() => void confirmAction(action, index)} disabled={actionBusy !== null} data-testid={`button-confirm-assistant-action-${index}`}><Check size={14} />{actionBusy === index ? 'Applying…' : `Confirm ${action.name}`}</button>)}</div>
              {actionError && <div className="pa-error" role="alert"><AlertCircle size={14} />{actionError}</div>}
            </div>}
                {sendMessage.isError && <div className="pa-form"><div className="pa-error" role="alert"><AlertCircle size={14} />{getErrorMessage(sendMessage.error)} <button className="pa-link-button" onClick={() => { const last = [...localMessages].reverse().find((item) => item.role === 'user'); if (last && consented) sendMessage.mutate({ data: { message: last.content } }, { onSuccess: (reply) => { const createdAt = new Date().toISOString(); queryClient.setQueryData<AssistantHistory>(historyKey, (old) => ({ messages: [...(old?.messages ?? []), { id: last.id, role: 'user' as const, content: last.content, createdAt }, { id: makeId(), role: 'assistant' as const, content: reply.answer, createdAt }] })); setLocalMessages((current) => current.filter((entry) => entry.id !== last.id)); setPendingActions(reply.actions ?? []); } }); }} data-testid="button-retry-assistant-message">Retry</button></div></div>}
            <form className="pa-form" onSubmit={submitMessage} data-testid="form-assistant-chat">
              <div className="pa-compose"><textarea aria-label="Message the kitchen assistant" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask about a meal, an ingredient, or your kitchen…" maxLength={4000} data-testid="input-assistant-message" /><button className="pa-send" type="submit" disabled={!consented || !message.trim() || sendMessage.isPending} aria-label="Send message" data-testid="button-send-assistant-message"><ArrowUp size={18} /></button></div>
            </form>
            <div className="pa-note">Assistant suggestions are just a preview. You decide what changes.</div>
          </section>

          <section className="pa-panel" aria-labelledby="pa-recipe-title">
            <div className="pa-panel-head"><div className="pa-title-wrap"><span className="pa-icon"><ChefHat size={17} /></span><div><h2 id="pa-recipe-title">Build a recipe</h2><div className="pa-subhead">A structured recipe, ready for your table</div></div></div></div>
            <form className="pa-section-body" onSubmit={submitRecipe} data-testid="form-assistant-recipe">
              <div className="pa-fields">
                <div className="pa-field full"><label htmlFor="assistant-recipe-prompt">What sounds good?</label><textarea id="assistant-recipe-prompt" className="pa-textarea" value={recipePrompt} onChange={(event) => setRecipePrompt(event.target.value)} placeholder="A cozy weeknight dinner, something bright with lentils…" maxLength={800} required data-testid="input-assistant-recipe-prompt" /></div>
                <div className="pa-field"><label htmlFor="assistant-recipe-servings">Servings</label><input id="assistant-recipe-servings" className="pa-input" type="number" min="1" max="30" value={servings} onChange={(event) => setServings(event.target.value)} data-testid="input-assistant-recipe-servings" /></div>
                <div className="pa-field"><label htmlFor="assistant-recipe-time">Time, in minutes</label><input id="assistant-recipe-time" className="pa-input" type="number" min="1" max="180" value={timeLimit} onChange={(event) => setTimeLimit(event.target.value)} data-testid="input-assistant-recipe-time" /></div>
              </div>
              <div className="pa-button-row"><button className="pa-button" type="submit" disabled={!consented || !recipePrompt.trim() || generateRecipe.isPending} data-testid="button-generate-assistant-recipe">{generateRecipe.isPending ? <LoaderCircle size={14} /> : <Sparkles size={14} />}{generateRecipe.isPending ? 'Putting it together…' : 'Create recipe'}</button><span className="pa-field-hint" style={{ alignSelf: 'center' }}>Uses your inventory and preferences</span></div>
              {generateRecipe.isError && <div className="pa-error" role="alert" data-testid="error-generate-recipe"><AlertCircle size={14} />{getErrorMessage(generateRecipe.error)}</div>}
              {recipe && <RecipeResult recipe={recipe} saved={recipeSaveState === 'saved'} saving={recipeSaveBusy} onSave={() => void saveGeneratedRecipe()} />}
              {recipeSaveError && <div className="pa-error" role="alert"><AlertCircle size={14} />{recipeSaveError}</div>}
            </form>
          </section>
        </div>

        <div className="pa-col">
          <section className="pa-panel" aria-labelledby="pa-scan-title">
            <div className="pa-panel-head"><div className="pa-title-wrap"><span className="pa-icon"><ImagePlus size={17} /></span><div><h2 id="pa-scan-title">Receipt & food photo</h2><div className="pa-subhead">Review every find before it goes anywhere</div></div></div></div>
            <div className="pa-section-body">
              <div className="pa-upload-box">
                <div className="pa-mode-row" role="group" aria-label="Image type">
                  <button type="button" className={`pa-mode ${scanMode === 'receipt' ? 'active' : ''}`} aria-pressed={scanMode === 'receipt'} onClick={() => { setScanMode('receipt'); setScanDrafts([]); setScanReviewed(false); }} data-testid="button-scan-mode-receipt"><ReceiptText size={14} /> Receipt</button>
                  <button type="button" className={`pa-mode ${scanMode === 'food_photo' ? 'active' : ''}`} aria-pressed={scanMode === 'food_photo'} onClick={() => { setScanMode('food_photo'); setScanDrafts([]); setScanReviewed(false); }} data-testid="button-scan-mode-food-photo"><ImagePlus size={14} /> Food photo</button>
                </div>
                <p className="pa-upload-info">{scanMode === 'receipt' ? 'We’ll look for grocery items to add to your shopping list.' : 'We’ll identify food for your kitchen inventory.'} Images are sent to Google for analysis and are not retained by Pantri. Maximum file size: 5 MB.</p>
                 <input ref={fileInput} type="file" accept="image/*" onChange={onImageSelected} hidden data-testid="input-kitchen-image" />
                 <button type="button" className="pa-button secondary" onClick={() => fileInput.current?.click()} disabled={scanBusy || analyzeImage.isPending} data-testid="button-upload-kitchen-image">{scanBusy || analyzeImage.isPending ? <LoaderCircle size={14} /> : <ImagePlus size={14} />}{scanBusy || analyzeImage.isPending ? 'Reviewing image…' : 'Choose an image'}</button>
                <button type="button" className="pa-button outline" style={{ marginLeft: 8 }} onClick={onManualEntry} data-testid="button-manual-inventory-entry"><Plus size={14} /> Enter manually</button>
                {selectedFile && !scanDrafts.length && (
                  <div className="pa-selected-image" style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#f7f7ef', border: '1px solid #e7e7dc' }}>
                    <strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{selectedFile.name}</strong>
                    <span className="pa-field-hint">{consented ? `Ready to analyze for ${scanMode === 'receipt' ? 'the shopping list' : 'kitchen inventory'}.` : 'Consent is required before this image leaves this device.'}</span>
                    <button type="button" className="pa-button" style={{ marginTop: 10 }} onClick={() => void analyzeSelectedFile(selectedFile)} disabled={scanBusy || analyzeImage.isPending || !consented} aria-describedby={!consented ? 'scan-analyze-disabled-reason' : undefined} data-testid="button-analyze-selected-image"><Sparkles size={14} />{scanBusy || analyzeImage.isPending ? 'Analyzing…' : scanError ? 'Try analysis again' : 'Analyze selected image'}</button>
                    {!consented && <p id="scan-analyze-disabled-reason" className="pa-field-hint" style={{ margin: '8px 0 0' }}>Analyze is disabled: check the data-use consent above first.</p>}
                  </div>
                )}
              </div>
              {analyzeImage.isError && <div className="pa-error" role="alert" data-testid="error-analyze-image"><AlertCircle size={14} />{getErrorMessage(analyzeImage.error)}</div>}
              {scanError && <div className="pa-error" role="alert" data-testid="error-scan-review"><AlertCircle size={14} />{scanError}</div>}
              {scanNotes && <p className="pa-scan-summary" data-testid="text-scan-notes">{scanNotes}</p>}
              {scanDrafts.length > 0 && <div data-testid="list-scan-candidates">
                <div className="pa-preview-title" style={{ marginTop: 13 }}>Review and select items</div>
                <p className="pa-scan-summary">Check the names, amounts, units, and location. Nothing is added unless you select it and confirm below.</p>
                <div className="pa-candidates">{scanDrafts.map((item, index) => <div className={`pa-candidate ${item.duplicate ? 'duplicate' : ''}`} key={`${normalizeName(item.name)}-${index}`} data-testid={`row-scan-candidate-${index}`}>
                  <div className="pa-candidate-top"><input type="checkbox" checked={item.selected} onChange={(event) => updateScanDraft(index, 'selected', event.target.checked)} aria-label={`Select ${item.name}`} data-testid={`checkbox-scan-candidate-${index}`} /><span className="pa-candidate-name">{item.name}</span><span className="pa-confidence">{Math.round(item.confidence * 100)}% confidence</span></div>
                  <div className="pa-candidate-fields">
                    <input className="pa-input" value={item.name} aria-label={`Name for item ${index + 1}`} onChange={(event) => updateScanDraft(index, 'name', event.target.value)} data-testid={`input-scan-name-${index}`} />
                    <input className="pa-input" type="number" min="0" step="any" value={item.quantity} aria-label={`Quantity for ${item.name}`} onChange={(event) => updateScanDraft(index, 'quantity', Number(event.target.value))} data-testid={`input-scan-quantity-${index}`} />
                    <input className="pa-input" value={item.unit} aria-label={`Unit for ${item.name}`} onChange={(event) => updateScanDraft(index, 'unit', event.target.value)} data-testid={`input-scan-unit-${index}`} />
                    <select className="pa-select" value={item.location} aria-label={`Location for ${item.name}`} onChange={(event) => updateScanDraft(index, 'location', event.target.value)} data-testid={`select-scan-location-${index}`}>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select>
                  </div>
                  {(item.duplicate || item.confidence < 0.72 || item.notes) && <div className="pa-candidate-note">{item.duplicate ? 'Possible duplicate: this name is already in your inventory, so it starts deselected. Confirm only if this is a separate item.' : item.confidence < 0.72 ? 'Uncertain match. Please check this item carefully.' : ''}{item.notes ? ` ${item.notes}` : ''}</div>}
                </div>)}</div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, color: '#617366', fontSize: 11, lineHeight: 1.4 }}><input type="checkbox" checked={scanReviewed} onChange={(event) => setScanReviewed(event.target.checked)} style={{ accentColor: '#397456', marginTop: 1 }} data-testid="checkbox-scan-review-confirmation" />I reviewed the selected items and want to add them to {scanMode === 'receipt' ? 'my shopping list' : 'my kitchen'}.</label>
                <div className="pa-button-row"><button className="pa-button" type="button" onClick={() => void addReviewedScanItems()} disabled={scanBusy || !scanReviewed || !scanDrafts.some((item) => item.selected)} data-testid="button-confirm-scan-items">{scanBusy ? 'Adding reviewed items…' : `Add selected (${scanDrafts.filter((item) => item.selected).length})`}</button><button className="pa-button quiet" type="button" onClick={() => { setScanDrafts([]); setScanReviewed(false); }} data-testid="button-cancel-scan-review">Discard review</button></div>
              </div>}
              {scanDrafts.length === 0 && !scanBusy && !analyzeImage.isPending && !scanError && <div className="pa-history-empty" style={{ marginTop: 12 }}><strong>No image to review</strong>Start with a photo, or use manual entry whenever that’s easier.</div>}
            </div>
          </section>
          <section className="pa-panel" aria-label="Your kitchen context">
            <div className="pa-panel-head"><div className="pa-title-wrap"><span className="pa-icon"><Sparkles size={17} /></span><div><h2>What Pantri knows</h2><div className="pa-subhead">A little context for better suggestions</div></div></div></div>
            <div className="pa-section-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {[{ label: 'In your kitchen', value: data.inventory.length }, { label: 'On your list', value: data.shopping.filter((item) => !item.checked).length }, { label: 'Saved recipes', value: data.savedRecipes.length }].map((stat) => <div key={stat.label} style={{ padding: '11px 9px', borderRadius: 12, background: '#f5f4ec', textAlign: 'center' }} data-testid={`stat-assistant-${stat.label.toLowerCase().replaceAll(' ', '-')}`}><strong style={{ display: 'block', font: '600 21px var(--app-font-serif,Georgia,serif)', color: '#41634c' }}>{stat.value}</strong><span style={{ fontSize: 9, color: '#879288' }}>{stat.label}</span></div>)}
              </div>
              <p className="pa-scan-summary" style={{ marginBottom: 0 }}>Your household cooks for {data.preferences.householdSize}. {data.preferences.dietaryFilters.length ? `Preferences: ${data.preferences.dietaryFilters.join(', ')}.` : 'No dietary preferences set.'} Pantry details stay in your account; assistant requests go to Google only after you give consent.</p>
            </div>
          </section>
        </div>
      </div>
      {clearHistory.isError && <div className="pa-error" style={{ marginTop: 14 }} role="alert" data-testid="error-clear-history"><AlertCircle size={14} />Could not clear history. {getErrorMessage(clearHistory.error)}<button className="pa-link-button" onClick={() => clearHistory.mutate(undefined, { onSuccess: () => { queryClient.setQueryData(historyKey, { messages: [] }); setLocalMessages([]); } })} data-testid="button-retry-clear-history">Retry</button></div>}
      {toast && <div className="pa-toast" role="status" data-testid="status-assistant-toast">{toast}</div>}
      <style>{`.pa-inline-spin{animation:pa-rotate 1s linear infinite;vertical-align:middle}@keyframes pa-rotate{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}

function RecipeResult({ recipe, saved, saving, onSave }: { recipe: GeneratedRecipe; saved: boolean; saving: boolean; onSave: () => void }) {
  return <article className="pa-recipe-result" data-testid="card-generated-recipe">
    <h3>{recipe.title}</h3>
    <div className="pa-recipe-meta"><span><Clock3 size={12} /> {recipe.minutes} min</span><span>{recipe.servings} servings</span>{recipe.caloriesPerServing != null && <span>{recipe.caloriesPerServing} cal / serving</span>}{recipe.dietaryTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    <div className="pa-recipe-columns">
      <section><h4>Ingredients</h4>{recipe.ingredients.map((ingredient, index) => <div className="pa-ingredient" key={`${ingredient.name}-${index}`} data-testid={`ingredient-generated-${index}`}><span>{ingredient.name}</span><span>{ingredient.quantity} {ingredient.unit}</span></div>)}</section>
      <section><h4>Method</h4><ol className="pa-instructions">{recipe.instructions.map((instruction, index) => <li key={`${index}-${instruction.slice(0, 20)}`}>{instruction}</li>)}</ol></section>
    </div>
    <div className="pa-button-row"><button type="button" className={`pa-button ${saved ? 'secondary' : ''}`} onClick={onSave} disabled={saved || saving} data-testid="button-save-generated-recipe">{saved ? <><Check size={14} /> Saved to recipes</> : saving ? <><LoaderCircle size={14} /> Saving…</> : <><Plus size={14} /> Save this recipe</>}</button></div>
    {saved && <div className="pa-status" role="status" data-testid="status-recipe-saved">Recipe saved to your collection.</div>}
  </article>;
}

export default AssistantPage;
