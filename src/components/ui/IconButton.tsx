import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  size?: number;
  iconSize?: number;
  color?: string;
  bg?: string;
};

export function IconButton({ icon, size = 42, iconSize = 20, color = 'var(--ag-crimson)', bg = '#fff', className = '', style, type = 'button', 'aria-label': ariaLabel, title, ...rest }: Props) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`flex items-center justify-center rounded-xl border-none cursor-pointer shadow-raised ${className}`}
      style={{ width: size, height: size, background: bg, ...style }}
      {...rest}
    >
      <Icon name={icon} style={{ color, fontSize: iconSize }} />
    </button>
  );
}
