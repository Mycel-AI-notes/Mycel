import { useGardenStore } from '@/stores/garden';
import { InboxView } from './inbox/InboxView';
import { ActionsView } from './actions/ActionsView';
import { ProjectsView, ProjectDetailView } from './projects/ProjectsView';
import { WaitingView } from './waiting/WaitingView';
import { SomedayView } from './someday/SomedayView';
import { WeeklyReview } from './review/WeeklyReview';

export function GardenView() {
  const view = useGardenStore((s) => s.view);
  if (!view) return null;
  switch (view.kind) {
    case 'inbox': return <InboxView />;
    case 'actions': return <ActionsView />;
    case 'projects': return <ProjectsView />;
    case 'project-detail': return <ProjectDetailView id={view.id} />;
    case 'waiting': return <WaitingView />;
    case 'someday': return <SomedayView />;
    case 'review': return <WeeklyReview />;
  }
}
