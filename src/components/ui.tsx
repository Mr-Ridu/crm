import React from 'react';
import { X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-hover active:bg-brand-active text-white shadow-card',
  secondary: 'bg-surface hover:bg-navy-soft/60 text-ink border border-line',
  ghost: 'text-muted hover:text-ink hover:bg-navy-soft/60',
  destructive: 'bg-danger-bg hover:bg-danger-border/60 text-danger-text border border-danger-border',
  success: 'bg-success-bg hover:bg-success-border/70 text-success-text border border-success-border',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-[13px]',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    {...rest}
  />
);

export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }
> = ({ label, size = 'md', className = '', type = 'button', ...rest }) => (
  <button
    type={type}
    title={label}
    aria-label={label}
    className={`inline-flex items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-ink hover:bg-navy-soft/60 transition cursor-pointer disabled:opacity-50 shrink-0 ${
      size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'
    } ${className}`}
    {...rest}
  />
);

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

const CONTROL_BASE =
  'rounded-lg border border-line bg-surface text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none transition';

export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = '', ...rest }, ref) => (
  <input ref={ref} className={`h-9 px-3 ${CONTROL_BASE} ${className}`} {...rest} />
));
TextInput.displayName = 'TextInput';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className = '', ...rest }, ref) => (
  <select ref={ref} className={`h-9 pl-2.5 pr-7 ${CONTROL_BASE} ${className}`} {...rest} />
));
Select.displayName = 'Select';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = '', ...rest }, ref) => (
  <textarea ref={ref} className={`px-3 py-2 ${CONTROL_BASE} ${className}`} {...rest} />
));
Textarea.displayName = 'Textarea';

export const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}> = ({ label, children, hint, className = '' }) => (
  <div className={className}>
    <label className="block text-[12px] font-semibold text-ink mb-1">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
  </div>
);

export const CheckboxRow: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}> = ({ checked, onChange, children }) => (
  <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 rounded border-line text-brand accent-[#6D5CE8]"
    />
    <span>{children}</span>
  </label>
);

/* ------------------------------------------------------------------ */
/* Surfaces: cards, sections, page headers                             */
/* ------------------------------------------------------------------ */

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`bg-surface rounded-lg border border-line shadow-card ${className}`}>
    {children}
  </div>
);

export const PageHeader: React.FC<{
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, description, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-0.5 text-[24px] leading-8 font-semibold tracking-tight text-ink">
        {title}
      </h1>
      {description && <p className="mt-1 text-[13px] text-muted max-w-2xl">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({
  children,
  right,
}) => (
  <div className="flex items-center justify-between gap-2">
    <h3 className="text-[15px] font-semibold text-ink">{children}</h3>
    {right}
  </div>
);

/* ------------------------------------------------------------------ */
/* Badges, tags, avatars                                               */
/* ------------------------------------------------------------------ */

type Tone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'purple'
  | 'green'
  | 'red'
  | 'blue'
  | 'amber';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-navy-soft/70 text-ink',
  brand: 'bg-brand-soft text-brand-active',
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  info: 'bg-info-bg text-info-text',
  purple: 'bg-brand-soft text-brand-active',
  green: 'bg-success-bg text-success-text',
  red: 'bg-danger-bg text-danger-text',
  blue: 'bg-info-bg text-info-text',
  amber: 'bg-warning-bg text-warning-text',
};

export const Badge: React.FC<{
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}> = ({ tone = 'neutral', children, className = '', title }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
  >
    {children}
  </span>
);

export const Dot: React.FC<{ color: string; className?: string }> = ({
  color,
  className = '',
}) => (
  <span
    className={`w-2 h-2 rounded-full shrink-0 ${className}`}
    style={{ backgroundColor: color }}
    aria-hidden="true"
  />
);

export const Avatar: React.FC<{
  name: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}> = ({ name, color = '#6D5CE8', size = 'sm', className = '' }) => {
  const sizes = { xs: 'w-5 h-5 text-[10px]', sm: 'w-7 h-7 text-[11px]', md: 'w-9 h-9 text-sm' };
  return (
    <span
      className={`rounded-full text-white font-semibold inline-flex items-center justify-center shrink-0 ${sizes[size]} ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
};

export const CountBadge: React.FC<{ count: number; tone?: Tone }> = ({
  count,
  tone = 'neutral',
}) => (
  <span
    className={`tnum inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-md text-[11px] font-semibold ${TONE_CLASSES[tone]}`}
  >
    {count}
  </span>
);

/* ------------------------------------------------------------------ */
/* Tabs / segmented control                                            */
/* ------------------------------------------------------------------ */

export interface TabOption {
  id: string;
  label: React.ReactNode;
}

export const SegmentedTabs: React.FC<{
  options: TabOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}> = ({ options, value, onChange, className = '' }) => (
  <div
    role="tablist"
    className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-navy-soft/50 p-0.5 ${className}`}
  >
    {options.map((opt) => {
      const active = opt.id === value;
      return (
        <button
          key={opt.id}
          role="tab"
          aria-selected={active}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`h-8 px-3 rounded-md text-[13px] font-medium transition cursor-pointer whitespace-nowrap ${
            active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

/* ------------------------------------------------------------------ */
/* Overlays: modal + drawer shells                                     */
/* ------------------------------------------------------------------ */

export const ModalShell: React.FC<{
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  label: string;
}> = ({ onClose, children, maxWidth = 'max-w-3xl', label }) => (
  <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-6">
    <div
      className="fixed inset-0 bg-navy/55 animate-fade-in"
      onClick={onClose}
      aria-hidden="true"
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`relative z-10 w-full ${maxWidth} h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[92vh] flex flex-col overflow-hidden overscroll-contain bg-surface rounded-none sm:rounded-xl border-0 sm:border border-line shadow-pop animate-fade-in`}
    >
      {children}
    </div>
  </div>
);

export const ModalHeader: React.FC<{
  title: string;
  description?: string;
  onClose: () => void;
}> = ({ title, description, onClose }) => (
  <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-line">
    <div className="min-w-0">
      <h2 className="text-[17px] font-semibold tracking-tight text-ink truncate">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
    </div>
    <IconButton label="Close dialog" onClick={onClose} className="border-0">
      <X className="w-4 h-4" />
    </IconButton>
  </div>
);

export const DrawerShell: React.FC<{
  onClose: () => void;
  children: React.ReactNode;
  label: string;
}> = ({ onClose, children, label }) => (
  <div className="fixed inset-0 z-50">
    <div
      className="fixed inset-0 bg-navy/55 animate-fade-in"
      onClick={onClose}
      aria-label="Close backdrop"
    />
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="absolute inset-y-0 right-0 z-10 w-full sm:max-w-2xl lg:max-w-4xl bg-surface shadow-pop flex flex-col overflow-hidden animate-drawer-in sm:rounded-l-xl sm:border-l sm:border-y sm:border-line"
    >
      {children}
    </aside>
  </div>
);

/* ------------------------------------------------------------------ */
/* Feedback: empty state, inline alert                                 */
/* ------------------------------------------------------------------ */

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, description, action, icon }) => (
  <div className="flex flex-col items-center justify-center text-center px-6 py-12">
    {icon && (
      <span className="w-10 h-10 rounded-xl bg-canvas border border-line text-faint flex items-center justify-center mb-3">
        {icon}
      </span>
    )}
    <p className="text-[14px] font-semibold text-ink">{title}</p>
    {description && <p className="mt-1 text-[13px] text-muted max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: Tone;
}> = ({ label, value, tone = 'neutral' }) => {
  const valueTones: Record<Tone, string> = {
    neutral: 'text-ink',
    brand: 'text-brand-active',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
    info: 'text-info-text',
    purple: 'text-brand-active',
    green: 'text-success-text',
    red: 'text-danger-text',
    blue: 'text-info-text',
    amber: 'text-warning-text',
  };
  return (
    <div className="bg-surface rounded-lg border border-line shadow-card px-4 py-3.5">
      <p className="text-[12px] font-medium text-muted truncate">{label}</p>
      <p className={`mt-1 text-[22px] leading-7 font-semibold tracking-tight tnum ${valueTones[tone]}`}>
        {value}
      </p>
    </div>
  );
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ open, onClose, title, description, children, wide }) => {
  if (!open) return null;
  return (
    <ModalShell onClose={onClose} maxWidth={wide ? 'max-w-lg' : 'max-w-md'} label={title}>
      <ModalHeader title={title} description={description} onClose={onClose} />
      <div className="px-5 sm:px-6 py-4 overflow-y-auto">{children}</div>
    </ModalShell>
  );
};

export const InlineAlert: React.FC<{
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}> = ({ tone = 'info', children, className = '' }) => {
  const tones: Record<Tone, string> = {
    neutral: 'bg-navy-soft/60 border-line text-ink',
    brand: 'bg-brand-soft border-brand-border text-brand-active',
    success: 'bg-success-bg border-success-border text-success-text',
    warning: 'bg-warning-bg border-warning-border text-warning-text',
    danger: 'bg-danger-bg border-danger-border text-danger-text',
    info: 'bg-info-bg border-info-border text-info-text',
    purple: 'bg-brand-soft border-brand-border text-brand-active',
    green: 'bg-success-bg border-success-border text-success-text',
    red: 'bg-danger-bg border-danger-border text-danger-text',
    blue: 'bg-info-bg border-info-border text-info-text',
    amber: 'bg-warning-bg border-warning-border text-warning-text',
  };
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </div>
  );
};
