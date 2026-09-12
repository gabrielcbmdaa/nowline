import { useState } from 'react';

export type FabAction = {
  label: string;
  onSelect: () => void;
};

type Props = {
  actions: FabAction[];
};

export function Fab({ actions }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fab-area">
      {open && (
        <div className="fab-menu">
          {actions.map((action) => (
            <button
              key={action.label}
              className="fab-menu__item"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="fab"
        aria-label={open ? 'Close menu' : 'Add'}
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {open ? '✕' : '+'}
      </button>
    </div>
  );
}
