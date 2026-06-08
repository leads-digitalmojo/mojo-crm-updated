import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db, functions } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { Opportunity } from '../../types';
import { toast } from 'react-hot-toast';
import { Activity, RefreshCw, Star, AlertCircle, CheckCircle2, XCircle, TrendingUp, TrendingDown, BookOpen } from 'lucide-react';
import { formatCurrency } from '../../utils/format';

const WinLossAnalysis: React.FC = () => {
  const [leads, setLeads] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'potential' | 'won' | 'lost' | 'abandoned'>('all');
  const [activeTab, setActiveTab] = useState<'individual' | 'global'>('individual');
  const [globalReports, setGlobalReports] = useState<any[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [triggeringGlobal, setTriggeringGlobal] = useState(false);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'opportunities'),
        where('status', 'in', ['Won', 'Lost', 'Abandoned'])
      );
      const snapshot = await getDocs(q);
      const fetchedLeads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Opportunity));
      
      // Sort in memory by statusChangedAt or updatedAt (desc)
      fetchedLeads.sort((a, b) => {
        const timeA = a.statusChangedAt ? new Date(a.statusChangedAt).getTime() : new Date(a.updatedAt).getTime();
        const timeB = b.statusChangedAt ? new Date(b.statusChangedAt).getTime() : new Date(b.updatedAt).getTime();
        return timeB - timeA;
      });

      setLeads(fetchedLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast.error('Failed to load closed leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'individual') {
      fetchLeads();
    } else {
      fetchGlobalReports();
    }
  }, [activeTab]);

  const fetchGlobalReports = async () => {
    setLoadingGlobal(true);
    try {
      const q = query(
        collection(db, 'system_metrics'),
        where('type', '==', 'global_win_loss_summary')
      );
      const snapshot = await getDocs(q);
      const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Sort manually to avoid needing a composite index
      reports.sort((a: any, b: any) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
      
      setGlobalReports(reports);
    } catch (error) {
      console.error('Error fetching global reports:', error);
      toast.error('Failed to load global reports');
    } finally {
      setLoadingGlobal(false);
    }
  };

  const handleTriggerGlobal = async () => {
    setTriggeringGlobal(true);
    try {
      const triggerFn = httpsCallable(functions, 'triggerGlobalWinLossAnalysisManual');
      await triggerFn();
      toast.success('Global analysis generated successfully!');
      await fetchGlobalReports(); // Refresh to show results
    } catch (error: any) {
      console.error('Global analysis error:', error);
      toast.error(error?.message || 'Failed to generate global analysis');
    } finally {
      setTriggeringGlobal(false);
    }
  };

  const handleAnalyze = async (leadId: string) => {
    setAnalyzingId(leadId);
    try {
      const analyzeFn = httpsCallable(functions, 'analyzeWinLossManual');
      await analyzeFn({ opportunityId: leadId });
      toast.success('Analysis complete!');
      await fetchLeads(); // Refresh to show results
    } catch (error: any) {
      console.error('Analysis error:', error);
      toast.error(error?.message || 'Failed to analyze lead');
    } finally {
      setAnalyzingId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Won': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'Lost': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'Abandoned': return <AlertCircle className="w-5 h-5 text-gray-500" />;
      default: return null;
    }
  };

  const getScoreColor = (score?: number) => {
    if (score === undefined) return 'bg-gray-100 text-gray-800';
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const filteredLeads = leads.filter(lead => {
    if (filter === 'all') return true;
    if (filter === 'potential') return lead.winLossAnalysis?.isPotentialLead === true;
    return lead.status.toLowerCase() === filter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Win/Loss Analysis</h2>
          <p className="text-sm text-gray-500 mt-1">AI-powered post-mortem and global pipeline insights.</p>
        </div>
        
        <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('individual')}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              activeTab === 'individual' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Individual Leads
          </button>
          <button
            onClick={() => setActiveTab('global')}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              activeTab === 'global' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Global Insights
          </button>
        </div>
      </div>

      {activeTab === 'individual' && (
        <>
          <div className="flex justify-end items-center mb-4 space-x-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="block w-40 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="all">All Closed Leads</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="abandoned">Abandoned</option>
              <option value="potential">Potential Revivals</option>
            </select>
            <button
              onClick={fetchLeads}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredLeads.length === 0 ? (
              <div className="bg-white p-8 rounded-lg border border-gray-200 text-center text-gray-500">
                No leads found for the selected filter.
              </div>
            ) : (
          filteredLeads.map(lead => (
            <div key={lead.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 transition-shadow hover:shadow-md">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <h3 className="text-lg font-medium text-gray-900">{lead.name}</h3>
                    <div className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100">
                      {getStatusIcon(lead.status)}
                      <span className="ml-1 text-gray-800">{lead.status}</span>
                    </div>
                    {lead.winLossAnalysis?.isPotentialLead && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <Star className="w-3 h-3 mr-1" /> Potential Revival
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-500 flex items-center space-x-4">
                    <span>{lead.company || 'No Company'}</span>
                    <span>•</span>
                    <span>{formatCurrency(lead.value)}</span>
                    <span>•</span>
                    <span>Closed: {new Date(lead.statusChangedAt || lead.updatedAt).toLocaleDateString()}</span>
                  </div>

                  {lead.winLossAnalysis ? (
                    <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getScoreColor(lead.winLossAnalysis.score)}`}>
                          Analysis Score: {lead.winLossAnalysis.score}/100
                        </span>
                        <span className="text-xs text-gray-400">
                          Analyzed {new Date(lead.winLossAnalysis.analyzedAt || Date.now()).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 font-medium">Combined Reason:</p>
                      <p className="text-sm text-gray-600 mt-1">{lead.winLossAnalysis.combinedReason}</p>
                      
                      {lead.winLossAnalysis.isPotentialLead && lead.winLossAnalysis.potentialReason && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-sm text-blue-700 font-medium flex items-center">
                            <Star className="w-4 h-4 mr-1" /> Revival Potential
                          </p>
                          <p className="text-sm text-blue-600 mt-1">{lead.winLossAnalysis.potentialReason}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 flex items-center text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-md border border-amber-100 w-fit">
                      <Activity className="w-4 h-4 mr-2" />
                      Pending AI Analysis
                    </div>
                  )}
                </div>

                <div className="ml-6">
                  <button
                    onClick={() => handleAnalyze(lead.id!)}
                    disabled={analyzingId === lead.id}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analyzingId === lead.id ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        Analyzing...
                      </>
                    ) : (
                      'Run AI Analysis'
                    )}
                  </button>
                </div>
              </div>
            </div>
            ))
          )}
        </div>
        </>
      )}

      {activeTab === 'global' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Global Pipeline Post-Mortem</h3>
            <button
              onClick={handleTriggerGlobal}
              disabled={triggeringGlobal}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {triggeringGlobal ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                'Generate Report Now'
              )}
            </button>
          </div>

          {loadingGlobal ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : globalReports.length === 0 ? (
            <div className="bg-white p-8 rounded-lg border border-gray-200 text-center text-gray-500">
              No global reports generated yet. Click the button above to generate one.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {globalReports.map(report => (
                <div key={report.id} className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <div>
                      <h4 className="text-lg font-medium text-gray-900 flex items-center">
                        <Activity className="w-5 h-5 mr-2 text-indigo-600" />
                        AI Global Analysis Report
                      </h4>
                      <p className="text-sm text-gray-500 mt-1">
                        Generated on {new Date(report.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* WON LEADS ANALYSIS */}
                      <div className="space-y-4">
                        <h5 className="font-semibold text-gray-900 flex items-center text-green-700 border-b pb-2">
                          <CheckCircle2 className="w-5 h-5 mr-2" />
                          Won Leads Analysis
                        </h5>
                        
                        <div>
                          <p className="text-sm font-medium text-gray-700">Overall Summary</p>
                          <p className="text-sm text-gray-600 mt-1">{report.data?.wonLeadsAnalysis?.overallSummary || 'N/A'}</p>
                        </div>
                        
                        <div>
                          <p className="text-sm font-medium text-gray-700 flex items-center mt-3">
                            <Star className="w-4 h-4 mr-1 text-yellow-500" /> Key Success Factors
                          </p>
                          <ul className="mt-2 space-y-1">
                            {report.data?.wonLeadsAnalysis?.keySuccessFactors?.map((factor: string, idx: number) => (
                              <li key={idx} className="text-sm text-gray-600 flex items-start">
                                <span className="text-green-500 mr-2">•</span>
                                {factor}
                              </li>
                            ))}
                          </ul>
                        </div>
                        
                        <div className="bg-green-50 p-3 rounded-md">
                          <p className="text-sm font-medium text-green-800 flex items-center">
                            <TrendingUp className="w-4 h-4 mr-1" /> Recommendation
                          </p>
                          <p className="text-sm text-green-700 mt-1">{report.data?.wonLeadsAnalysis?.actionableRecommendation || 'N/A'}</p>
                        </div>
                      </div>
                      
                      {/* LOST/ABANDONED LEADS ANALYSIS */}
                      <div className="space-y-4">
                        <h5 className="font-semibold text-gray-900 flex items-center text-red-700 border-b pb-2">
                          <XCircle className="w-5 h-5 mr-2" />
                          Lost & Abandoned Analysis
                        </h5>
                        
                        <div>
                          <p className="text-sm font-medium text-gray-700">Overall Summary</p>
                          <p className="text-sm text-gray-600 mt-1">{report.data?.lostLeadsAnalysis?.overallSummary || 'N/A'}</p>
                        </div>
                        
                        <div>
                          <p className="text-sm font-medium text-gray-700 flex items-center mt-3">
                            <AlertCircle className="w-4 h-4 mr-1 text-amber-500" /> Common Failure Reasons
                          </p>
                          <ul className="mt-2 space-y-1">
                            {report.data?.lostLeadsAnalysis?.commonFailureReasons?.map((reason: string, idx: number) => (
                              <li key={idx} className="text-sm text-gray-600 flex items-start">
                                <span className="text-red-500 mr-2">•</span>
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                        
                        <div className="bg-red-50 p-3 rounded-md">
                          <p className="text-sm font-medium text-red-800 flex items-center">
                            <TrendingDown className="w-4 h-4 mr-1" /> Recommendation
                          </p>
                          <p className="text-sm text-red-700 mt-1">{report.data?.lostLeadsAnalysis?.actionableRecommendation || 'N/A'}</p>
                        </div>
                      </div>
                      
                    </div>
                    
                    {/* EXECUTIVE SUMMARY */}
                    <div className="mt-8 border-t pt-6">
                      <h5 className="font-semibold text-gray-900 flex items-center border-b pb-2 mb-4">
                        <BookOpen className="w-5 h-5 mr-2 text-indigo-600" />
                        Executive Directives (Sales Manager Focus)
                      </h5>
                      <ul className="space-y-2">
                        {report.data?.executiveDirectives?.map((directive: string, idx: number) => (
                          <li key={idx} className="text-sm text-gray-700 flex items-start p-2 hover:bg-gray-50 rounded-md">
                            <div className="bg-indigo-100 text-indigo-700 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mr-3">
                              {idx + 1}
                            </div>
                            {directive}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WinLossAnalysis;
