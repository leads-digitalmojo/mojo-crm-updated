import React, { useState } from 'react';
import DailyBriefing from './DailyBriefing';
import ClientLookup from './ClientLookup';
import PipelineHealth from './PipelineHealth';
import WinLossAnalysis from './WinLossAnalysis';
import MonthlyAnalysis from './MonthlyAnalysis';

const CommandCentre: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'briefing' | 'lookup' | 'health' | 'winloss' | 'monthly'>('briefing');
  const [lookupTargetOppId, setLookupTargetOppId] = useState<string | null>(null);

  const handleOpenClientLookup = (oppId: string) => {
    setLookupTargetOppId(oppId);
    setActiveTab('lookup');
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header and Tabs */}
      <div className="border-b border-gray-200">
        <div className="px-6 py-5">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Command Centre</h1>
          <p className="text-gray-500 mt-1 text-sm">Live overview of company operations and pipeline health.</p>
        </div>
        <div className="flex px-6 space-x-8">
          <button
            onClick={() => setActiveTab('briefing')}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === 'briefing' ? 'text-black' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Daily Briefing
            {activeTab === 'briefing' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-black" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('lookup')}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === 'lookup' ? 'text-black' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Client Lookup
            {activeTab === 'lookup' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-black" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('health')}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === 'health' ? 'text-black' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Pipeline Health
            {activeTab === 'health' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-black" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('winloss')}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === 'winloss' ? 'text-black' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Win/Loss Analysis
            {activeTab === 'winloss' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-black" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === 'monthly' ? 'text-black' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Monthly Analysis
            {activeTab === 'monthly' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-black" />
            )}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-[#FAFAFA]">
        {activeTab === 'briefing' && <DailyBriefing onOpenClientLookup={handleOpenClientLookup} />}
        {activeTab === 'lookup' && (
          <ClientLookup 
            initialSelectedOppId={lookupTargetOppId} 
            onClearInitialOppId={() => setLookupTargetOppId(null)} 
          />
        )}
        {activeTab === 'health' && <PipelineHealth onOpenClientLookup={handleOpenClientLookup} />}
        {activeTab === 'winloss' && <WinLossAnalysis />}
        {activeTab === 'monthly' && <MonthlyAnalysis />}
      </div>
    </div>
  );
};

export default CommandCentre;
