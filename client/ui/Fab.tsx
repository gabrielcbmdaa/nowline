import { useRef, useState } from 'react';

export type FabAction = {
  label: string;
  onSelect: () => void;
};

type Props = {
  actions: FabAction[];
};

export function Fab({ actions }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div className="fab-area">
      {open && (
        <div className="fab-menu">
          {actions.map((action) => (
            <button
              key={action.label}
              className="fab-menu__item"
              onClick={() => {
                // The menu-button pattern: choosing an item hands focus back to
                // the button that opens the menu. The item is about to unmount,
                // and a sheet opened by the action records whoever has focus
                // now as the element to return it to — without this line that
                // was nothing, and closing the sheet dropped focus on <body>.
                trigger.current?.focus();
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
        ref={trigger}
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
