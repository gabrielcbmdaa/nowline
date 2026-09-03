import type { TabId } from '../state/store';

const TABS: { id: TabId; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'summary', label: 'Summary' },
  { id: 'projects', label: 'Projects' },
];

type Props = {
  active: TabId;
  onChange: (tab: TabId) => void;
};

export function TopTabs({ active, onChange }: Props) {
  return (
    <nav className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`tab ${active === tab.id ? 'tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
