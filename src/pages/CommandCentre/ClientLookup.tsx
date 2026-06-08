import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { Search, Activity as ActivityIcon, User, Phone, Mail, Building, Target, Clock, ShieldAlert, ChevronRight, CheckSquare } from 'lucide-react';
import { getEmployeeName } from "../../lib/admin";
import { format, differenceInDays } from 'date-fns';
import { formatCurrency, safeParseISO } from '../../utils/format';
import { Opportunity } from '../../types';
import { ADMIN_CONFIG } from '../../lib/admin';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

const calculateHealthScore = (opp: Opportunity): number => {
  if (opp.status === 'Won') return 100;
  if (opp.status === 'Abandoned' || opp.status === 'Lost') return 0;
  
  let score = 85; 

  const today = new Date();
  let lastActDate = opp.updatedAt ? safeParseISO(opp.updatedAt) : safeParseISO(opp.createdAt || today.toISOString());
  if (Array.isArray(opp.activities) && opp.activities.length > 0 && opp.activities[0].timestamp) {
    lastActDate = safeParseISO(opp.activities[0].timestamp);
  }
  const daysInactive = differenceInDays(today, lastActDate);
  if (daysInactive > 3) {
    score -= (daysInactive - 3) * 2;
  }

  let slaCount = 0;
  if (opp.followUpEscalated) slaCount++;
  if (Array.isArray(opp.tasks)) {
    opp.tasks.forEach(t => { if (t.emailEscalated) slaCount++; });
  }
  score -= slaCount * 10;

  if (Array.isArray(opp.calls) && opp.calls.length > 0) {
    let totalRating = 0;
    let ratingCount = 0;
    opp.calls.forEach(c => {
      if (c.aiAnalysis?.rating) {
        totalRating += c.aiAnalysis.rating;
        ratingCount++;
      }
    });
    if (ratingCount > 0) {
      const avgRating = totalRating / ratingCount;
      score += (avgRating - 5) * 2;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
};

const getHealthColor = (score: number) => {
  if (score >= 80) return 'text-green-600 bg-green-50';
  if (score >= 60) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
};

interface ClientLookupProps {
  initialSelectedOppId?: string | null;
  onClearInitialOppId?: () => void;
}

const ClientLookup: React.FC<ClientLookupProps> = ({ initialSelectedOppId, onClearInitialOppId }) => {
  const navigate = useNavigate();
  const { opportunities } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOppId, setSelectedOppId] = useState<string | null>(initialSelectedOppId || null);
  const [isGeneratingReview, setIsGeneratingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleGenerateReview = async () => {
    if (!selectedOppId) return;
    setIsGeneratingReview(true);
    setReviewError(null);
    try {
      const analyzeFn = httpsCallable(functions, 'analyzeClientReviewManual');
      const result = await analyzeFn({ opportunityId: selectedOppId });
      
      // Update local state directly so it shows immediately without refresh
      useStore.setState(state => ({
        opportunities: state.opportunities.map(o => 
          o.id === selectedOppId ? { ...o, clientReview: result.data as any } : o
        )
      }));
    } catch (error: any) {
      console.error('Error generating AI review:', error);
      setReviewError(error.message || 'Failed to generate review. Please try again.');
    } finally {
      setIsGeneratingReview(false);
    }
  };

  React.useEffect(() => {
    if (initialSelectedOppId) {
      setSelectedOppId(initialSelectedOppId);
      if (onClearInitialOppId) onClearInitialOppId();
    }
  }, [initialSelectedOppId, onClearInitialOppId]);

  const filteredOpps = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    return opportunities.filter(o => 
      o.name?.toLowerCase().includes(term) ||
      o.companyName?.toLowerCase().includes(term) ||
      o.contactEmail?.toLowerCase().includes(term) ||
      o.contactPhone?.includes(term)
    ).slice(0, 5); // Max 5 results for dropdown
  }, [searchTerm, opportunities]);

  const selectedOpp = useMemo(() => {
    return opportunities.find(o => o.id === selectedOppId);
  }, [selectedOppId, opportunities]);

  const healthScore = selectedOpp ? calculateHealthScore(selectedOpp) : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto animate-in fade-in zoom-in-95 duration-300 h-full flex flex-col">
      {/* Search Header */}
      <div className="max-w-2xl w-full mx-auto relative mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text"
            placeholder="Search clients by name, company, email, or phone..."
            className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300 text-base"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Dropdown Results */}
        {searchTerm && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden z-50">
            {filteredOpps.length > 0 ? (
              filteredOpps.map(opp => (
                <button
                  key={opp.id}
                  className="w-full text-left px-6 py-4 hover:bg-gray-50 border-b border-gray-50 last:border-0 flex items-center justify-between group transition-colors"
                  onClick={() => {
                    setSelectedOppId(opp.id);
                    setSearchTerm('');
                  }}
                >
                  <div>
                    <h4 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{opp.name}</h4>
                    <p className="text-sm text-gray-500 mt-0.5">{opp.companyName || 'No Company'} · {opp.contactEmail || opp.contactPhone || 'No contact info'}</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
                </button>
              ))
            ) : (
              <div className="px-6 py-4 text-gray-500 text-center">No clients found matching "{searchTerm}"</div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {selectedOpp ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden pb-10">
          
          {/* Left Column: Client Details & Health */}
          <div className="lg:col-span-1 space-y-6 overflow-y-auto pr-2">
            
            {/* Health Score Card */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 flex flex-col items-center justify-center text-center">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline Health</h3>
              <div className={`w-32 h-32 rounded-full flex items-center justify-center border-8 ${
                healthScore >= 80 ? 'border-green-100' : healthScore >= 60 ? 'border-amber-100' : 'border-red-100'
              }`}>
                <div className={`text-4xl font-black ${
                  healthScore >= 80 ? 'text-green-600' : healthScore >= 60 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {healthScore}
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-4">
                {healthScore >= 80 ? 'Client is highly engaged. Deal progressing well.' : 
                 healthScore >= 60 ? 'Deal is at risk. Needs attention.' : 
                 'Critical risk of abandonment. Immediate intervention required.'}
              </p>
            </div>

            {/* Details Card */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6 capitalize">{selectedOpp.name}</h2>
              
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Building size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-700 capitalize">{selectedOpp.companyName || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-700">{selectedOpp.contactEmail || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-700">{selectedOpp.contactPhone || 'N/A'}</span>
                </div>
                <div className="h-px bg-gray-100 my-4" />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Value</span>
                  <span className="font-bold text-gray-900">{formatCurrency(selectedOpp.value)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Stage</span>
                  <span className="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded-md text-xs">{selectedOpp.stage}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Status</span>
                  <span className="font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded-md text-xs">{selectedOpp.status}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Owner</span>
                  <span className="font-medium text-gray-900 text-sm flex items-center gap-1">
                    <User size={14} className="text-gray-400" /> 
                    {getEmployeeName(selectedOpp.owner)}
                  </span>
                </div>
                <div className="pt-4 mt-2 border-t border-gray-100 flex justify-end">
                  <button 
                    onClick={() => navigate(`/opportunities?oppId=${selectedOpp.id}`)}
                    className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-bold rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Open Lead Box <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Recent Notes Card */}
            {Array.isArray(selectedOpp.notes) && selectedOpp.notes.length > 0 && (
              <div className="bg-amber-50/50 rounded-2xl border border-amber-100/50 p-6">
                <h3 className="text-sm font-bold text-amber-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <CheckSquare size={14} /> Recent Notes
                </h3>
                <div className="space-y-3">
                  {[...selectedOpp.notes]
                    .filter(note => note && typeof note === 'object')
                    .sort((a, b) => {
                       const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                       const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                       return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
                    })
                    .slice(0, 3)
                    .map((note, idx) => (
                      <div key={note.id || `note-${idx}`} className="bg-white p-3 rounded-xl border border-amber-100/50 shadow-sm">
                        <p className="text-xs text-gray-600 line-clamp-3">{note.content || 'No content'}</p>
                        <time className="text-[9px] text-gray-400 mt-1 block">
                          {note.createdAt ? format(safeParseISO(note.createdAt), 'MMM d, h:mm a') : 'Unknown'}
                        </time>
                      </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Review Card */}
            {selectedOpp.status === 'Open' && (
              <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl border border-indigo-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-widest flex items-center gap-2">
                    <ActivityIcon size={14} /> AI Client Review
                  </h3>
                  {!selectedOpp.clientReview && (
                    <button
                      onClick={handleGenerateReview}
                      disabled={isGeneratingReview}
                      className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {isGeneratingReview ? 'Analyzing...' : 'Generate Review'}
                    </button>
                  )}
                </div>

                {reviewError && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                    {reviewError}
                  </div>
                )}

                {selectedOpp.clientReview ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-800 uppercase mb-1">What we're doing right</h4>
                      <p className="text-sm text-indigo-950 bg-white/60 p-3 rounded-lg border border-white">
                        {selectedOpp.clientReview.strengths}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-indigo-800 uppercase mb-1">What can be improved</h4>
                      <p className="text-sm text-indigo-950 bg-white/60 p-3 rounded-lg border border-white">
                        {selectedOpp.clientReview.improvements}
                      </p>
                    </div>
                    <div className="text-[10px] text-indigo-400 text-right mt-2 font-medium">
                      Analyzed: {format(safeParseISO(selectedOpp.clientReview.analyzedAt), 'MMM d, h:mm a')}
                      <button 
                        onClick={handleGenerateReview}
                        disabled={isGeneratingReview}
                        className="ml-2 text-indigo-600 hover:underline disabled:opacity-50 disabled:no-underline"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                ) : (
                  !isGeneratingReview && (
                    <div className="text-sm text-indigo-700 text-center py-4 bg-white/40 rounded-lg border border-indigo-100/50">
                      Generate an AI review to get actionable insights and improvements for this lead.
                    </div>
                  )
                )}
                {isGeneratingReview && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-3">
                    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p className="text-sm text-indigo-700 font-medium animate-pulse">AI is analyzing client history...</p>
                  </div>
                )}
              </div>
            )}


          </div>

          {/* Right Column: Activity Timeline */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 flex flex-col h-full overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between bg-white z-10">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <ActivityIcon size={18} className="text-gray-400" />
                Complete Activity Timeline
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 relative">
              {!Array.isArray(selectedOpp.activities) || selectedOpp.activities.length === 0 ? (
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-gray-200 before:via-gray-100 before:to-transparent">
                  {/* Fallback base activity if no history exists */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-gray-50 text-gray-400 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 shadow-sm">
                      <ActivityIcon size={14} className="text-purple-500" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-900">System</span>
                        <time className="text-[10px] text-gray-400 font-medium">
                          {selectedOpp.createdAt ? format(safeParseISO(selectedOpp.createdAt), 'MMM d, yyyy h:mm a') : 'Unknown'}
                        </time>
                      </div>
                      <p className="text-sm text-gray-600">Opportunity created.</p>
                      <div className="mt-2 text-xs font-medium text-gray-500 flex items-center gap-2">
                         <span>Current Stage: <span className="text-gray-900 font-bold">{selectedOpp.stage}</span></span>
                         <span>•</span>
                         <span>Status: <span className="text-gray-900 font-bold">{selectedOpp.status}</span></span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-gray-200 before:via-gray-100 before:to-transparent">
                  {selectedOpp.activities.map((act) => (
                    <div key={act.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-gray-50 text-gray-400 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 shadow-sm">
                        {act.type === 'stage_change' && <Target size={14} className="text-blue-500" />}
                        {act.type === 'status_change' && <ActivityIcon size={14} className="text-purple-500" />}
                        {act.type === 'note_added' && <CheckSquare size={14} className="text-amber-500" />}
                        {act.type === 'task_added' && <Clock size={14} className="text-green-500" />}
                        {act.type === 'assignment_change' && <User size={14} className="text-indigo-500" />}
                        {act.type === 'followup_update' && <Phone size={14} className="text-pink-500" />}
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-900">{act.userName}</span>
                          <time className="text-[10px] text-gray-400 font-medium">
                            {(() => {
                              try {
                                return act.timestamp ? format(safeParseISO(act.timestamp), 'MMM d, h:mm a') : 'Unknown';
                              } catch {
                                return 'Invalid time';
                              }
                            })()}
                          </time>
                        </div>
                        <p className="text-sm text-gray-600">{act.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
            <Search size={32} className="text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Select a Client</h2>
          <p className="text-gray-500 mt-2 max-w-sm">Use the search bar above to find a client and view their complete health profile and timeline.</p>
        </div>
      )}
    </div>
  );
};

export default ClientLookup;
