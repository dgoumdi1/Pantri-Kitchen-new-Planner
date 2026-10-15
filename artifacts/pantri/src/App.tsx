import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Apple, Archive, CalendarDays, Check, ChefHat, CircleAlert, Clock3, Egg, Fish, Leaf, Milk, Pencil, Plus, Refrigerator, Search, ShoppingBasket, Snowflake, Sparkles, Trash2, Wheat, X } from 'lucide-react';
import { Navigation } from './components/Navigation';
import { FoodItemDialog } from './components/FoodItemDialog';
import { AssistantPage } from './pages/AssistantPage';
import { recipes, matchesInventory } from './data/recipes';
import { readLegacyData } from './lib/storage';
import type { AppData, FoodItem, Preferences, Recipe, ShoppingItem } from './lib/types';
import {
  getGetMyDataQueryKey,
  useDeleteMyAccountData,
  useGetMyData,
  useImportMyData,
  useSaveMyData,
  type AccountData,
  type AssistantAction,
  type GeneratedRecipe,
} from '@workspace/api-client-react';

const dietaryChoices = ['Halal', 'Vegan', 'Vegetarian', 'Lactose-Free'];
const todayIso = () => new Date().toISOString().slice(0, 10);
const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true } },
});

const emptyData = (): AppData => ({
  inventory: [],
  shopping: [],
  preferences: { dietaryFilters: [], householdSize: 2, units: 'Metric', expirationReminders: true },
  savedRecipes: [],
  mealPlan: [],
});

function toApiData(data: AppData): AccountData {
  return {
    ...data,
    inventory: data.inventory.map((item) => ({ ...item, expirationDate: item.expirationDate || null })),
  };
}

function fromApiData(data: AccountData): AppData {
  return {
    ...data,
    inventory: data.inventory.map((item) => ({ ...item, expirationDate: item.expirationDate ?? '' })),
  };
}

function greetingFor(name: string | undefined, date: Date): string {
  if (!name?.trim()) return 'Welcome to Pantri';
  const hour = date.getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${greeting}, ${name.trim()}`;
}

function useLocalGreeting(name: string | undefined) {
  const [greeting, setGreeting] = useState(() => greetingFor(name, new Date()));
  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setGreeting(greetingFor(name, now));
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      timer = window.setTimeout(refresh, Math.max(250, nextHour.getTime() - now.getTime() + 25));
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [name]);
  return greeting;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      appearance={{ variables: { colorPrimary: '#397456', colorBackground: '#fffdf8', colorForeground: '#30453a', borderRadius: '14px' } }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?">
            <AuthPage mode="sign-in" />
          </Route>
          <Route path="/sign-up/*?">
            <AuthPage mode="sign-up" />
          </Route>
          <Route>
            <PrivatePantri />
          </Route>
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <div className="auth-screen">
      <div className="auth-brand"><span className="brand-mark"><Leaf size={19} /></span><span>Pantri</span></div>
      <p className="auth-copy">A little more joy, less waste.</p>
      {mode === 'sign-in'
        ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
        : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}
    </div>
  );
}

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  useEffect(() => {
    let previous: string | null | undefined;
    return addListener(({ user }) => {
      const next = user?.id ?? null;
      if (previous !== undefined && previous !== next) cache.clear();
      previous = next;
    });
  }, [addListener, cache]);
  return null;
}

function PrivatePantri() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="auth-loading" role="status">Loading your kitchen…</div>;
  if (!isSignedIn) return <Redirect to={`${basePath}/sign-in`} />;
  return <PantriApp />;
}

function PantriApp() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const cache = useQueryClient();
  const dataQuery = useGetMyData();
  const saveMutation = useSaveMyData();
  const importMutation = useImportMyData();
  const deleteAccountMutation = useDeleteMyAccountData();
  const [showFoodDialog, setShowFoodDialog] = useState(false);
  const [editingFood, setEditingFood] = useState<FoodItem | undefined>();
  const [toast, setToast] = useState('');
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const legacyData = useRef<AppData | null>(readLegacyData());
  const accountId = user?.id ?? '';
  const data = dataQuery.data ? fromApiData(dataQuery.data) : emptyData();
  const displayName = user?.fullName || user?.firstName || undefined;
  const greeting = useLocalGreeting(displayName);

  useEffect(() => {
    if (!accountId || !dataQuery.isSuccess || !legacyData.current) return;
    const imported = localStorage.getItem(`pantri-imported:${accountId}`);
    const dismissed = localStorage.getItem(`pantri-import-dismissed:${accountId}`);
    if (!imported && !dismissed) setShowImportPrompt(true);
  }, [accountId, dataQuery.isSuccess]);

  const persistData = async (next: AppData) => {
    const saved = await saveMutation.mutateAsync({ data: toApiData(next) });
    cache.setQueryData(getGetMyDataQueryKey(), saved);
  };

  const updateData = (next: AppData) => {
    void persistData(next).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : 'Your changes could not be saved. Please retry.');
    });
  };
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  };
  const saveFood = (food: Omit<FoodItem, 'id'>) => {
    const inventory = editingFood
      ? data.inventory.map((item) => item.id === editingFood.id ? { ...food, id: item.id } : item)
      : [{ ...food, id: createId() }, ...data.inventory];
    updateData({ ...data, inventory });
    setShowFoodDialog(false);
    setEditingFood(undefined);
    notify(editingFood ? 'Your kitchen is updated.' : 'Added to your kitchen.');
  };
  const openAdd = () => { setEditingFood(undefined); setShowFoodDialog(true); };
  const openEdit = (item: FoodItem) => { setEditingFood(item); setShowFoodDialog(true); };
  const deleteFood = (id: string) => {
    const item = data.inventory.find((food) => food.id === id);
    if (!item || !window.confirm(`Remove ${item.name} from your kitchen?`)) return;
    updateData({ ...data, inventory: data.inventory.filter((food) => food.id !== id) });
    notify(`${item.name} removed.`);
  };
  const changePreferences = (preferences: Preferences) => updateData({ ...data, preferences });
  const addShopping = (item: Omit<ShoppingItem, 'id'>) => {
    const exists = data.shopping.some((entry) => entry.name.toLowerCase() === item.name.toLowerCase() && !entry.checked);
    if (exists) return;
    updateData({ ...data, shopping: [...data.shopping, { ...item, id: createId() }] });
  };
  const toggleShopping = (id: string) => updateData({ ...data, shopping: data.shopping.map((item) => item.id === id ? { ...item, checked: !item.checked } : item) });
  const deleteShopping = (id: string) => updateData({ ...data, shopping: data.shopping.filter((item) => item.id !== id) });

  const applyAssistantAction = async (action: AssistantAction) => {
    if (action.type === 'add_inventory') {
      const exists = data.inventory.some((item) => item.name.trim().toLowerCase() === action.name.trim().toLowerCase());
      if (exists) throw new Error(`${action.name} is already in your kitchen. Review the existing item instead.`);
      await persistData({ ...data, inventory: [{ id: createId(), name: action.name, quantity: action.quantity, unit: action.unit, location: action.location, expirationDate: '' }, ...data.inventory] });
      return;
    }
    if (data.shopping.some((item) => item.name.trim().toLowerCase() === action.name.trim().toLowerCase() && !item.checked)) return;
    await persistData({ ...data, shopping: [...data.shopping, { id: createId(), name: action.name, quantity: action.quantity, unit: action.unit, checked: false }] });
  };

  const saveGeneratedRecipe = async (recipe: GeneratedRecipe) => {
    if (data.savedRecipes.some((saved) => saved.title.trim().toLowerCase() === recipe.title.trim().toLowerCase())) {
      throw new Error('A recipe with this title is already saved.');
    }
    await persistData({ ...data, savedRecipes: [recipe, ...data.savedRecipes] });
  };

  const importLegacy = async () => {
    if (!legacyData.current || !accountId) return;
    setImportBusy(true);
    setImportError('');
    let requestId = localStorage.getItem(`pantri-import-request:${accountId}`);
    if (!requestId) {
      requestId = crypto.randomUUID();
      localStorage.setItem(`pantri-import-request:${accountId}`, requestId);
    }
    try {
      const imported = await importMutation.mutateAsync({ data: { requestId, data: toApiData(legacyData.current) } });
      cache.setQueryData(getGetMyDataQueryKey(), imported);
      localStorage.setItem(`pantri-imported:${accountId}`, '1');
      setShowImportPrompt(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The import did not finish. Please retry.');
    } finally {
      setImportBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!user || !window.confirm('Delete your Pantri account and all saved kitchen data? This cannot be undone.')) return;
    await deleteAccountMutation.mutateAsync();
    await user.delete();
    await signOut({ redirectUrl: basePath || '/' });
    cache.clear();
  };

  const updateDisplayName = async (name: string) => {
    const parts = name.trim().split(/\s+/);
    await user?.update({ firstName: parts[0] || '', lastName: parts.slice(1).join(' ') });
  };

  if (dataQuery.isLoading) return <div className="auth-loading" role="status">Opening your kitchen…</div>;
  if (dataQuery.isError) return <div className="auth-loading" role="alert">Your kitchen could not be loaded. <button className="button button-outline" onClick={() => void dataQuery.refetch()}>Try again</button></div>;

  return (
      <div className="app-shell">
        <Navigation />
        <main className="app-main">
          <Switch>
            <Route path="/">
              <Dashboard data={data} greeting={greeting} onAdd={openAdd} onEdit={openEdit} onDelete={deleteFood} />
            </Route>
            <Route path="/recipes">
              <RecipesPage data={data} onPreferences={changePreferences} onAddShopping={addShopping} notify={notify} />
            </Route>
            <Route path="/shopping">
              <ShoppingPage data={data} onAdd={addShopping} onToggle={toggleShopping} onDelete={deleteShopping} />
            </Route>
            <Route path="/assistant">
              <AssistantPage data={toApiData(data)} userId={accountId} onApplyAction={applyAssistantAction} onSaveRecipe={saveGeneratedRecipe} onManualEntry={openAdd} />
            </Route>
            <Route path="/settings">
              <SettingsPage preferences={data.preferences} onChange={changePreferences} displayName={displayName ?? ''} onSaveName={updateDisplayName} onDeleteAccount={deleteAccount} onSignOut={() => void signOut({ redirectUrl: basePath || '/' })} />
            </Route>
            <Route>
              <NotFound />
            </Route>
          </Switch>
        </main>
        {showImportPrompt && legacyData.current && <div className="import-banner" role="dialog" aria-labelledby="import-title" data-testid="dialog-import-legacy">
          <div><strong id="import-title">Bring your browser kitchen into this account?</strong><p>{legacyData.current.inventory.length} foods, {legacyData.current.shopping.length} shopping items, and your preferences are saved in this browser. This may include Pantri sample items. Nothing is imported until you choose.</p>
            {importError && <div className="form-error" role="alert">{importError}</div>}
          </div>
          <div className="import-actions"><button className="button button-primary" onClick={() => void importLegacy()} disabled={importBusy} data-testid="button-import-legacy">{importBusy ? 'Importing…' : 'Review and import'}</button><button className="button button-outline" onClick={() => { localStorage.setItem(`pantri-import-dismissed:${accountId}`, '1'); setShowImportPrompt(false); }} disabled={importBusy} data-testid="button-skip-import">Not now</button></div>
        </div>}
        {showFoodDialog && <FoodItemDialog item={editingFood} onClose={() => { setShowFoodDialog(false); setEditingFood(undefined); }} onSave={saveFood} />}
        {toast && <div className="toast-note" role="status" data-testid="status-toast">{toast}</div>}
      </div>
  );
}

function Dashboard({ data, greeting, onAdd, onEdit, onDelete }: { data: AppData; greeting: string; onAdd: () => void; onEdit: (item: FoodItem) => void; onDelete: (id: string) => void }) {
  const [location, setLocation] = useState('All');
  const countAt = (place: string) => data.inventory.filter((item) => item.location === place).length;
  const inventory = data.inventory.filter((item) => location === 'All' || item.location === location);
  const expiring = data.inventory.filter((item) => {
    if (!item.expirationDate) return false;
    const days = Math.ceil((new Date(`${item.expirationDate}T23:59:59`).getTime() - Date.now()) / 86400000);
    return days <= 7;
  }).sort((a, b) => a.expirationDate.localeCompare(b.expirationDate)).slice(0, 5);
  const sortedRecipes = [...recipes].map((recipe) => ({ recipe, have: recipe.ingredients.filter((ingredient) => matchesInventory(ingredient, data.inventory)).length }))
    .sort((a, b) => b.have - a.have);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">A fresh start in your kitchen</div>
          <h1 className="page-title" data-testid="text-dashboard-greeting">{greeting}</h1>
          <p className="page-subtitle">Here’s what’s waiting in your kitchen today.</p>
        </div>
        <button className="button button-primary" onClick={onAdd} data-testid="button-add-food"><Plus size={17} /> Add item</button>
      </div>
      <div className="stats-grid" aria-label="Kitchen inventory summary">
        <Stat icon={<Archive size={20} />} label="Pantry" count={countAt('Pantry')} />
        <Stat icon={<Refrigerator size={20} />} label="Fridge" count={countAt('Fridge')} />
        <Stat icon={<Snowflake size={20} />} label="Freezer" count={countAt('Freezer')} />
      </div>
      <div className="inventory-layout">
        <section>
          <div className="section-heading">
            <h2>In your kitchen <span style={{ color: '#97a196', fontSize: 14, fontFamily: 'DM Sans' }}>· {data.inventory.length} items</span></h2>
            <button className="button button-quiet button-small" onClick={onAdd} data-testid="button-add-food-secondary"><Plus size={15} /> Add food</button>
          </div>
          <div className="filter-row" role="group" aria-label="Filter by storage location">
            {['All', 'Pantry', 'Fridge', 'Freezer'].map((place) => (
              <button key={place} className={`filter-pill ${location === place ? 'active' : ''}`} onClick={() => setLocation(place)} aria-pressed={location === place} data-testid={`filter-location-${place.toLowerCase()}`}>{place}{place === 'All' ? ` ${data.inventory.length}` : ` ${countAt(place)}`}</button>
            ))}
          </div>
          <div className="panel inventory-list" data-testid="list-inventory">
            {inventory.length ? inventory.map((item) => <InventoryRow key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />) : (
              <div className="empty-state"><strong>Your {location.toLowerCase()} is ready for something good.</strong>Add a food item to keep track of it here.</div>
            )}
          </div>
        </section>
        <aside>
          {data.preferences.expirationReminders && (
          <div className="panel expiring-card">
            <div className="expiring-head"><CircleAlert size={18} /> Use these soon</div>
            <p style={{ color: '#896d51', fontSize: 12, margin: '7px 0 0' }}>A little nudge to enjoy them before they go.</p>
            {expiring.length ? (
              <ul className="expiring-list">
                {expiring.map((item) => <li key={item.id} data-testid={`expiring-item-${item.id}`}><span>{item.name}</span><span className="expiring-date">{item.expirationDate < todayIso() ? 'Expired' : `By ${formatDate(item.expirationDate)}`}</span></li>)}
              </ul>
            ) : <div className="empty-state" style={{ padding: '18px 0 0', color: '#896d51' }}>Nothing close to expiring. Nice work.</div>}
          </div>
          )}
          <div className="section-heading" style={{ marginTop: 24 }}>
            <h2>Cook with what you have</h2>
          </div>
          <div className="panel" style={{ padding: '2px 15px' }}>
            {sortedRecipes.slice(0, 3).map(({ recipe, have }) => (
              <div key={recipe.id} style={{ padding: '12px 0', borderBottom: '1px solid #f0ede5' }} data-testid={`suggestion-${recipe.id}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{recipe.title}</strong>
                  <span style={{ fontSize: 10, color: '#5b825f', whiteSpace: 'nowrap' }}>{have === recipe.ingredients.length ? 'All on hand' : `${recipe.ingredients.length - have} to get`}</span>
                </div>
              </div>
            ))}
            <Link href="/recipes" style={{ display: 'block', padding: '12px 0', color: '#397456', fontSize: 12, fontWeight: 700 }} data-testid="link-all-recipes">See all recipe ideas →</Link>
          </div>
        </aside>
      </div>
    </>
  );
}

function Stat({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return <div className="panel stat-card" data-testid={`stat-${label.toLowerCase()}`}><span className="stat-icon">{icon}</span><div><div className="stat-num">{count}</div><div className="stat-label">{label} items</div></div></div>;
}

function InventoryRow({ item, onEdit, onDelete }: { item: FoodItem; onEdit: (item: FoodItem) => void; onDelete: (id: string) => void }) {
  const expired = item.expirationDate < todayIso();
  const days = Math.ceil((new Date(`${item.expirationDate}T23:59:59`).getTime() - Date.now()) / 86400000);
  const isSoon = days <= 7;
  return (
    <div className="inventory-row" data-testid={`row-food-${item.id}`}>
      <span className="food-symbol"><Apple size={19} /></span>
      <div className="item-info">
        <div className="item-name" data-testid={`text-food-name-${item.id}`}>{item.name}</div>
        <div className="item-meta">{item.quantity} {item.unit} <span aria-hidden="true">·</span> {item.location}</div>
      </div>
      <div style={{ minWidth: 66, textAlign: 'right', fontSize: 11, color: expired ? '#b05d4c' : isSoon ? '#b07844' : '#8b968c' }}>
        <div>{!item.expirationDate ? 'No date' : expired ? 'Expired' : isSoon ? <Clock3 size={12} style={{ display: 'inline', marginRight: 3 }} /> : <CalendarDays size={12} style={{ display: 'inline', marginRight: 3 }} />}{item.expirationDate && !expired && formatDate(item.expirationDate)}</div>
      </div>
      <div className="row-actions">
        <button className="icon-button" onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`} data-testid={`button-edit-food-${item.id}`}><Pencil size={15} /></button>
        <button className="icon-button" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.name}`} data-testid={`button-delete-food-${item.id}`}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function RecipesPage({ data, onPreferences, onAddShopping, notify }: { data: AppData; onPreferences: (preferences: Preferences) => void; onAddShopping: (item: Omit<ShoppingItem, 'id'>) => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const filteredRecipes = useMemo(() => recipes.map((recipe) => {
    const present = recipe.ingredients.filter((ingredient) => matchesInventory(ingredient, data.inventory));
    const missing = recipe.ingredients.filter((ingredient) => !matchesInventory(ingredient, data.inventory));
    return { recipe, present, missing };
  }).filter(({ recipe, missing }) => {
    const dietaryOkay = data.preferences.dietaryFilters.every((filter) => recipe.dietaryTags.includes(filter));
    const searchOkay = `${recipe.title} ${recipe.ingredients.join(' ')}`.toLowerCase().includes(query.toLowerCase());
    return dietaryOkay && searchOkay && (!onlyMatches || missing.length === 0);
  }).sort((a, b) => a.missing.length - b.missing.length), [data.inventory, data.preferences.dietaryFilters, query, onlyMatches]);
  const toggleFilter = (choice: string) => {
    const dietaryFilters = data.preferences.dietaryFilters.includes(choice)
      ? data.preferences.dietaryFilters.filter((item) => item !== choice)
      : [...data.preferences.dietaryFilters, choice];
    onPreferences({ ...data.preferences, dietaryFilters });
  };
  const addMissing = (recipe: Recipe, missing: string[]) => {
    missing.forEach((name) => onAddShopping({ name, checked: false, sourceRecipe: recipe.title }));
    notify(missing.length ? `Added ${missing.length} missing ${missing.length === 1 ? 'ingredient' : 'ingredients'}.` : 'You have everything for this one.');
  };
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Good things from your kitchen</div><h1 className="page-title">Recipes for your kitchen</h1><p className="page-subtitle">A few lovely ideas, sorted by what you already have.</p></div>
      </div>
      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        <label htmlFor="recipe-search" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>Find a recipe or ingredient</label>
        <div style={{ position: 'relative' }}><Search size={17} style={{ position: 'absolute', left: 13, top: 13, color: '#8b968c' }} /><input id="recipe-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your next meal..." data-testid="input-recipe-search" style={{ width: '100%', height: 44, padding: '0 12px 0 40px', borderRadius: 11, border: '1px solid #e2e1d8', background: '#fffefa', outline: 'none' }} /></div>
        <div className="filter-row" style={{ margin: '13px 0 0' }} role="group" aria-label="Dietary filters">
          {dietaryChoices.map((choice) => <button key={choice} className={`filter-pill ${data.preferences.dietaryFilters.includes(choice) ? 'active' : ''}`} aria-pressed={data.preferences.dietaryFilters.includes(choice)} onClick={() => toggleFilter(choice)} data-testid={`filter-diet-${choice.toLowerCase().replaceAll(' ', '-')}`}>{choice}</button>)}
          {data.preferences.dietaryFilters.length > 0 && <button className="filter-pill" onClick={() => onPreferences({ ...data.preferences, dietaryFilters: [] })} data-testid="button-clear-filters">Clear filters</button>}
          <button className={`filter-pill ${onlyMatches ? 'active' : ''}`} aria-pressed={onlyMatches} onClick={() => setOnlyMatches(!onlyMatches)} data-testid="filter-have-all">Have it all</button>
        </div>
      </div>
      <div className="section-heading"><h2>{filteredRecipes.length} thoughtful ideas</h2><span style={{ color: '#87948a', fontSize: 12 }}>Ranked by ingredients on hand</span></div>
      {filteredRecipes.length ? <div className="recipe-grid">{filteredRecipes.map(({ recipe, present, missing }) => <RecipeCard key={recipe.id} recipe={recipe} present={present} missing={missing} onOpen={() => setSelectedRecipe(recipe)} onAdd={() => addMissing(recipe, missing)} />)}</div> : <div className="panel empty-state"><strong>No recipes in this little corner.</strong>Try another search or clear a dietary filter.</div>}
      {selectedRecipe && <RecipeModal recipe={selectedRecipe} inventory={data.inventory} onClose={() => setSelectedRecipe(null)} onAdd={(missing) => addMissing(selectedRecipe, missing)} />}
    </>
  );
}

function RecipeCard({ recipe, present, missing, onOpen, onAdd }: { recipe: Recipe; present: string[]; missing: string[]; onOpen: () => void; onAdd: () => void }) {
  const badge = missing.length === 0 ? 'You have all ingredients' : `Missing ${missing.length} ingredient${missing.length === 1 ? '' : 's'}`;
  return (
    <article className="panel recipe-card" data-testid={`card-recipe-${recipe.id}`}>
      <button onClick={onOpen} aria-label={`View ${recipe.title} recipe`} style={{ border: 0, padding: 0, width: '100%', background: 'none', color: 'inherit', textAlign: 'left' }} data-testid={`button-view-recipe-${recipe.id}`}>
        <div className="recipe-art"><span aria-hidden="true">{recipeIcon(recipe.foodIcon)}</span><span className="match-badge">{badge}</span></div>
        <div className="recipe-body">
          <h3 className="recipe-title">{recipe.title}</h3>
          <div className="recipe-meta"><span><Clock3 size={12} style={{ display: 'inline' }} /> {recipe.minutes} min</span><span>{recipe.calories} cal</span><span>{present.length}/{recipe.ingredients.length} on hand</span></div>
          <div className="tag-row">{recipe.dietaryTags.slice(0, 3).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
        </div>
      </button>
      {missing.length > 0 && <div style={{ padding: '0 15px 15px' }}><button className="button button-quiet button-small" onClick={onAdd} data-testid={`button-add-missing-${recipe.id}`}><Plus size={14} /> Add Missing Items to Shopping List</button></div>}
    </article>
  );
}

function recipeIcon(icon: string) {
  const map: Record<string, ReactNode> = {
    salad: <Leaf size={49} strokeWidth={1.5} />, tomato: <Apple size={49} strokeWidth={1.5} />, bowl: <ChefHat size={49} strokeWidth={1.5} />,
    rice: <Wheat size={49} strokeWidth={1.5} />, soup: <Milk size={49} strokeWidth={1.5} />, toast: <Wheat size={49} strokeWidth={1.5} />,
    curry: <CookingPotIcon />, potato: <Egg size={49} strokeWidth={1.5} />, taco: <ShoppingBasket size={49} strokeWidth={1.5} />,
    fish: <Fish size={49} strokeWidth={1.5} />, oats: <Wheat size={49} strokeWidth={1.5} />,
  };
  return map[icon] ?? <Leaf size={49} />;
}

function CookingPotIcon() {
  return <ChefHat size={49} strokeWidth={1.5} />;
}

function RecipeModal({ recipe, inventory, onClose, onAdd }: { recipe: Recipe; inventory: FoodItem[]; onClose: () => void; onAdd: (missing: string[]) => void }) {
  const missing = recipe.ingredients.filter((ingredient) => !matchesInventory(ingredient, inventory));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="recipe-modal-title" data-testid="dialog-recipe">
        <div className="modal-head">
          <div><div className="eyebrow">A recipe to make at home</div><h2 id="recipe-modal-title">{recipe.title}</h2></div>
          <button className="icon-button" aria-label="Close recipe" onClick={onClose} data-testid="button-close-recipe"><X size={19} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 17 }}><span className="tag"><Clock3 size={12} style={{ display: 'inline' }} /> {recipe.minutes} min</span><span className="tag">{recipe.calories} calories</span>{recipe.dietaryTags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</div>
        <div className="eyebrow">Ingredients <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {recipe.ingredients.length - missing.length} on hand</span></div>
        <div className="recipe-detail" style={{ padding: '7px 0 18px' }}>
          {recipe.ingredients.map((ingredient) => <div className="ingredient-row" key={ingredient}><span>{ingredient}</span><span className={matchesInventory(ingredient, inventory) ? 'present' : 'missing'}>{matchesInventory(ingredient, inventory) ? 'On hand' : 'Add to list'}</span></div>)}
        </div>
        <div className="eyebrow">A few simple steps</div>
        <ol className="instructions">{recipe.instructions.map((step, index) => <li key={step}>{step}</li>)}</ol>
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          {missing.length > 0 && <button className="button button-primary" onClick={() => onAdd(missing)} data-testid={`button-recipe-modal-add-${recipe.id}`}><Plus size={15} /> Add missing items</button>}
          <button className="button button-outline" onClick={onClose} data-testid="button-done-recipe">Done</button>
        </div>
      </section>
    </div>
  );
}

function ShoppingPage({ data, onAdd, onToggle, onDelete }: { data: AppData; onAdd: (item: Omit<ShoppingItem, 'id'>) => void; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const active = data.shopping.filter((item) => !item.checked);
  const purchased = data.shopping.filter((item) => item.checked);
  const add = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), quantity: quantity ? Number(quantity) : undefined, unit: unit.trim() || undefined, checked: false });
    setName(''); setQuantity(''); setUnit('');
  };
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">A calmer kind of grocery run</div><h1 className="page-title">Shopping list</h1><p className="page-subtitle">{active.length} things to pick up, {purchased.length} already tucked away.</p></div>
      </div>
      <form className="panel shopping-add-form" onSubmit={add} style={{ padding: 17, display: 'grid', gridTemplateColumns: 'minmax(130px,1fr) 90px 110px auto', gap: 9, marginBottom: 20, alignItems: 'end' }} data-testid="form-shopping-add">
        <div className="field"><label htmlFor="shopping-name">Add something</label><input id="shopping-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fresh basil" required data-testid="input-shopping-name" /></div>
        <div className="field"><label htmlFor="shopping-quantity">Qty</label><input id="shopping-quantity" type="number" min="0.1" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="1" data-testid="input-shopping-quantity" /></div>
        <div className="field"><label htmlFor="shopping-unit">Unit</label><input id="shopping-unit" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="pieces" data-testid="input-shopping-unit" /></div>
        <button type="submit" className="button button-primary" data-testid="button-add-shopping"><Plus size={16} /> Add</button>
      </form>
      <div className="shopping-columns">
        <section className="panel shopping-panel">
          <div className="section-heading" style={{ margin: '0 0 8px' }}><h2>To pick up</h2><span className="tag">{active.length} items</span></div>
          {active.length ? active.map((item) => <ShoppingRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} />) : <div className="empty-state"><strong>Your list is clear.</strong>Add an ingredient or take a recipe shopping.</div>}
        </section>
        <section className="panel shopping-panel">
          <div className="section-heading" style={{ margin: '0 0 8px' }}><h2>Purchased</h2><span className="tag tag-warm">{purchased.length} items</span></div>
          {purchased.length ? purchased.map((item) => <ShoppingRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} />) : <div className="empty-state"><strong>Nothing checked off yet.</strong>Finished items will settle in here.</div>}
        </section>
      </div>
    </>
  );
}

function ShoppingRow({ item, onToggle, onDelete }: { item: ShoppingItem; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className="shopping-item" data-testid={`row-shopping-${item.id}`}>
      <input type="checkbox" className="check-input" checked={item.checked} onChange={() => onToggle(item.id)} aria-label={`${item.checked ? 'Mark not purchased' : 'Mark purchased'}: ${item.name}`} data-testid={`checkbox-shopping-${item.id}`} />
      <div className={`shopping-name ${item.checked ? 'shopping-checked' : ''}`}>
        <div>{item.name}{item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : item.unit ? ` · ${item.unit}` : ''}</div>
        {item.sourceRecipe && <div className="source-label">For {item.sourceRecipe}</div>}
      </div>
      <button className="icon-button" aria-label={`Delete ${item.name} from shopping list`} onClick={() => onDelete(item.id)} data-testid={`button-delete-shopping-${item.id}`}><Trash2 size={15} /></button>
    </div>
  );
}

function SettingsPage({ preferences, onChange, displayName, onSaveName, onDeleteAccount, onSignOut }: {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  displayName: string;
  onSaveName: (name: string) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(displayName);
  const [nameSaving, setNameSaving] = useState(false);
  const [accountError, setAccountError] = useState('');
  useEffect(() => setName(displayName), [displayName]);
  const update = (field: keyof Preferences, value: Preferences[keyof Preferences]) => onChange({ ...preferences, [field]: value });
  const saveName = async () => {
    setNameSaving(true);
    setAccountError('');
    try {
      await onSaveName(name);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Your name could not be saved.');
    } finally {
      setNameSaving(false);
    }
  };
  const removeAccount = async () => {
    setAccountError('');
    try {
      await onDeleteAccount();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Your account could not be deleted.');
    }
  };
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Make Pantri feel like yours</div><h1 className="page-title">A few preferences</h1><p className="page-subtitle">Small details to make meal planning fit your home.</p></div></div>
      <div className="settings-stack">
        <section className="panel settings-card">
          <h2 className="settings-title">Dietary preferences</h2>
          <p className="settings-description">Recipe ideas will always match every preference you choose.</p>
          <div className="choice-grid" role="group" aria-label="Dietary preferences">
            {dietaryChoices.map((choice) => <button key={choice} className={`choice-chip ${preferences.dietaryFilters.includes(choice) ? 'selected' : ''}`} aria-pressed={preferences.dietaryFilters.includes(choice)} onClick={() => update('dietaryFilters', preferences.dietaryFilters.includes(choice) ? preferences.dietaryFilters.filter((item) => item !== choice) : [...preferences.dietaryFilters, choice])} data-testid={`setting-diet-${choice.toLowerCase().replaceAll(' ', '-')}`}>{preferences.dietaryFilters.includes(choice) ? <Check size={13} style={{ display: 'inline', marginRight: 4 }} /> : null}{choice}</button>)}
          </div>
          {preferences.dietaryFilters.length > 0 && <button className="button button-outline button-small" style={{ marginTop: 13 }} onClick={() => update('dietaryFilters', [])} data-testid="button-settings-clear-diet">Clear preferences</button>}
        </section>
        <section className="panel settings-card">
          <h2 className="settings-title">Your household</h2>
          <p className="settings-description">Helpful defaults for quantities and your weekly shop.</p>
          <div className="setting-row"><label htmlFor="household-size">People at your table</label><select id="household-size" value={preferences.householdSize} onChange={(event) => update('householdSize', Number(event.target.value))} data-testid="select-household-size">{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'person' : 'people'}</option>)}</select></div>
          <div className="setting-row"><label htmlFor="units-setting">Measurement style</label><select id="units-setting" value={preferences.units} onChange={(event) => update('units', event.target.value as Preferences['units'])} data-testid="select-units">{['Metric', 'Imperial'].map((unit) => <option key={unit}>{unit}</option>)}</select></div>
          <div className="setting-row"><div><label htmlFor="expiration-reminders">Use-soon reminders</label><div style={{ color: '#87948a', fontSize: 12, marginTop: 3 }}>Show food close to its expiration date.</div></div><input id="expiration-reminders" className="check-input" type="checkbox" checked={preferences.expirationReminders} onChange={(event) => update('expirationReminders', event.target.checked)} data-testid="toggle-expiration-reminders" /></div>
        </section>
        <section className="panel settings-card">
          <h2 className="settings-title">Your account</h2>
          <p className="settings-description">Your kitchen and preferences sync to your account across devices.</p>
          <div className="field" style={{ maxWidth: 460 }}>
            <label htmlFor="display-name">Display name</label>
            <input id="display-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} data-testid="input-display-name" />
            <button className="button button-outline button-small" onClick={() => void saveName()} disabled={nameSaving || !name.trim()} data-testid="button-save-display-name">{nameSaving ? 'Saving…' : 'Save name'}</button>
          </div>
          <div className="account-actions">
            <button className="button button-outline" onClick={onSignOut} data-testid="button-sign-out">Sign out</button>
            <button className="button button-danger" onClick={() => void removeAccount()} data-testid="button-delete-account">Delete account and data</button>
          </div>
          {accountError && <div className="form-error" role="alert" data-testid="error-account-action">{accountError}</div>}
        </section>
      </div>
    </>
  );
}

function NotFound() {
  return <div className="panel empty-state" style={{ marginTop: 50 }}><strong>We couldn't find that little corner.</strong><Link href="/" style={{ color: '#397456' }} data-testid="link-back-home">Back to your kitchen</Link></div>;
}

export default App;
