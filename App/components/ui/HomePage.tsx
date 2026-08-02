import React, { useState } from 'react';
import type { WorkflowItem } from '../../types';
import { RunHistoryPage } from './RunHistoryPage';
import { WorkflowListHome } from './WorkflowListHome';
import { History, Workflow } from 'lucide-react';

interface HomePageProps {
  workflows: WorkflowItem[];
  initialFilterWorkflowId?: string | null;
  initialTab?: 'history' | 'workflows';
  onOpenWorkflow: (id: string) => void;
  onDuplicateWorkflow: (id: string) => void;
  onDeleteWorkflow: (id: string) => void;
  onEditWorkflowMeta: (
    id: string, name: string, description: string, icon: string, color: string
  ) => void;
  onOpenRun: (runId: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  workflows,
  initialFilterWorkflowId,
  initialTab,
  onOpenWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onEditWorkflowMeta,
  onOpenRun,
}) => {
  const [activeTab, setActiveTab] = useState<'history' | 'workflows'>(
    initialTab || 'history'
  );

  // Track which workflow to filter history by when switching from workflow list
  const [historyFilterWorkflowId, setHistoryFilterWorkflowId] = useState<string | null>(
    initialFilterWorkflowId || null
  );

  return (
    <div className="w-screen h-screen flex flex-col bg-surface-canvas font-sans text-body overflow-hidden antialiased">
      {/* Shared Header with Tabs */}
      <header className="h-14 px-3 sm:px-5 lg:px-7 bg-surface-canvas/90 border-b border-hairline flex items-center justify-between shrink-0 backdrop-blur-md z-30">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="p-2 rounded-lg bg-black text-white flex items-center justify-center shrink-0">
            <Workflow className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-1 bg-surface-card rounded-lg p-1 border border-hairline">
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Run </span>History
            </button>
            <button
              onClick={() => setActiveTab('workflows')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'workflows'
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Workflow className="w-3.5 h-3.5" />
              Workflows
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3" />
      </header>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'history' ? (
          <RunHistoryPage
            workflows={workflows}
            initialWorkflowId={historyFilterWorkflowId}
            onBack={() => setActiveTab('workflows')}
            onOpenRun={onOpenRun}
            embedded
          />
        ) : (
          <WorkflowListHome
            workflows={workflows}
            onOpenWorkflow={onOpenWorkflow}
            onDuplicateWorkflow={onDuplicateWorkflow}
            onDeleteWorkflow={onDeleteWorkflow}
            onEditWorkflowMeta={onEditWorkflowMeta}
            onOpenHistory={(workflowId) => {
              setHistoryFilterWorkflowId(workflowId);
              setActiveTab('history');
            }}
            embedded
          />
        )}
      </div>
    </div>
  );
};
