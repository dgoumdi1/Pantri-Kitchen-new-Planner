import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { FoodItem, Location } from '../lib/types';

type Props = { item?: FoodItem; onClose: () => void; onSave: (item: Omit<FoodItem, 'id'>) => void };
type Values = { name: string; quantity: string; unit: string; location: Location; expirationDate: string };

export function FoodItemDialog({ item, onClose, onSave }: Props) {
  const [values, setValues] = useState<Values>({
    name: item?.name ?? '',
    quantity: item ? String(item.quantity) : '',
    unit: item?.unit ?? 'pieces',
    location: item?.location ?? 'Pantry',
    expirationDate: item?.expirationDate ?? '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const update = (key: keyof Values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.name.trim()) { setError('Please add a food name.'); return; }
    if (!values.quantity || Number(values.quantity) <= 0) { setError('Quantity must be greater than zero.'); return; }
    onSave({ name: values.name.trim(), quantity: Number(values.quantity), unit: values.unit, location: values.location, expirationDate: values.expirationDate });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="food-dialog-title" data-testid="dialog-food-item">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Your kitchen, in good order</div>
            <h2 id="food-dialog-title">{item ? 'Edit food item' : 'Add to your kitchen'}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose} data-testid="button-close-food-dialog"><X size={19} /></button>
        </div>
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
            <button type="button" className="button button-outline" onClick={onClose} data-testid="button-cancel-food">Cancel</button>
            <button type="submit" className="button button-primary" data-testid="button-save-food">{item ? 'Save changes' : 'Add item'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
