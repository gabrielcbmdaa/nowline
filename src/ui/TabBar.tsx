import type { ComponentType } from 'react';
import type { TabId } from '../state/store';
import { CalendarIcon, ProjectsIcon, SummaryIcon, type IconProps } from './icons';

/** The label is no longer drawn, but it still names the button for screen readers. */
const TABS: { id: TabId; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { id: 'summary', label: 'Summary', Icon: SummaryIcon },
  { id: 'projects', label: 'Projects', Icon: ProjectsIcon },
];

type Props = {
  active: TabId;
  onChange: (tab: TabId) => void;
};

export function TabBar({ active, onChange }: Props) {
  return (
    <nav className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          aria-current={active === tab.id ? 'page' : undefined}
          aria-label={tab.label}
          className={`tab ${active === tab.id ? 'tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <tab.Icon className="tab__icon" />
        </button>
      ))}
    </nav>
  );
}
