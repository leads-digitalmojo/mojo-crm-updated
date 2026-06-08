import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { WebhookConfig, IncomingWebhookLog } from '../types';
import { Webhook, Trash2, Activity, Play, Plus } from 'lucide-react';
import { toast } from 'react-hot-toast';

const Webhooks: React.FC = () => {
  const [outgoingWebhooks, setOutgoingWebhooks] = useState<WebhookConfig[]>([]);
  const [incomingLogs, setIncomingLogs] = useState<IncomingWebhookLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  // Form state
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newEvents, setNewEvents] = useState<('Lead Created' | 'Status Changed')[]>(['Lead Created']);

  const FIREBASE_PROJECT_ID = process.env.REACT_APP_FIREBASE_PROJECT_ID || 'leads-digitalmojo';
  const INCOMING_WEBHOOK_URL = `https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net/incomingWebhook`;
  const STATIC_API_KEY = 'dm-secret-key-2026';

  useEffect(() => {
    const unsubscribeOutgoing = onSnapshot(
      query(collection(db, 'webhooks'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const webhooksData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as WebhookConfig[];
        setOutgoingWebhooks(webhooksData);
      },
      (error) => {
        console.error('Error fetching webhooks:', error);
      }
    );

    const unsubscribeIncoming = onSnapshot(
      query(collection(db, 'incoming_webhooks'), orderBy('receivedAt', 'desc')),
      (snapshot) => {
        const logsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as IncomingWebhookLog[];
        setIncomingLogs(logsData);
        setIsLoading(false);
      },
      (error) => {
        console.error('Error fetching incoming webhook logs:', error);
        setIsLoading(false);
      }
    );

    return () => {
      unsubscribeOutgoing();
      unsubscribeIncoming();
    };
  }, []);

  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl || newEvents.length === 0) {
      toast.error('URL and at least one event are required');
      return;
    }

    try {
      setIsAdding(true);
      await addDoc(collection(db, 'webhooks'), {
        url: newUrl,
        secret: newSecret || null,
        events: newEvents,
        isActive: true,
        createdAt: new Date().toISOString()
      });
      toast.success('Webhook added successfully');
      setNewUrl('');
      setNewSecret('');
      setNewEvents(['Lead Created']);
    } catch (error) {
      console.error('Error adding webhook:', error);
      toast.error('Failed to add webhook');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this webhook?')) return;
    try {
      await deleteDoc(doc(db, 'webhooks', id));
      toast.success('Webhook deleted');
    } catch (error) {
      console.error('Error deleting webhook:', error);
      toast.error('Failed to delete webhook');
    }
  };

  const handleTestWebhook = async (url: string, secret?: string) => {
    try {
      const testWebhookFn = httpsCallable(functions, 'testWebhook');
      const response = await testWebhookFn({ url, secret });
      
      if ((response.data as any).success) {
        toast.success('Test successful!');
      } else {
        toast.error('Test failed');
      }
    } catch (error: any) {
      toast.error(`Test failed: ${error.message}`);
    }
  };

  if (isLoading) {
    return <div className="p-8">Loading webhooks...</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Webhook className="text-brand-blue" />
          Webhooks Management
        </h1>
        <p className="text-gray-500 mt-2">Manage incoming and outgoing data connections.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Incoming Webhooks */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Activity className="text-green-500" />
              Incoming Webhook
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Send POST requests to this URL to log incoming data in the CRM.
            </p>
            
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Endpoint URL</p>
              <code className="text-sm text-gray-800 break-all">{INCOMING_WEBHOOK_URL}</code>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Required Headers</p>
              <code className="text-sm text-gray-800">x-api-key: {STATIC_API_KEY}</code>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Received Payloads</h2>
            <div className="max-h-96 overflow-y-auto space-y-4">
              {incomingLogs.length === 0 ? (
                <p className="text-gray-500 text-sm">No incoming webhooks received yet.</p>
              ) : (
                incomingLogs.map(log => (
                  <div key={log.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50">
                    <p className="text-xs text-gray-500 mb-2">
                      {new Date(log.receivedAt).toLocaleString()}
                    </p>
                    <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Outgoing Webhooks */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Webhook className="text-blue-500" />
              Outgoing Webhooks
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Configure URLs to receive data when specific events occur in the CRM.
            </p>

            <form onSubmit={handleAddWebhook} className="space-y-4 mb-8 bg-gray-50 p-4 rounded-lg border border-gray-100">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payload URL</label>
                <input
                  type="url"
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-brand-blue focus:border-brand-blue sm:text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Secret Header (Optional)</label>
                <input
                  type="text"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder="e.g., my-secret-token"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-brand-blue focus:border-brand-blue sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This will be sent as the <code>x-webhook-secret</code> header in outgoing POST requests.
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Events to trigger</label>
                <div className="space-y-2">
                  {(['Lead Created', 'Status Changed'] as const).map(event => (
                    <label key={event} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={newEvents.includes(event)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewEvents([...newEvents, event]);
                          } else {
                            setNewEvents(newEvents.filter(ev => ev !== event));
                          }
                        }}
                        className="h-4 w-4 text-brand-blue focus:ring-brand-blue border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-600">{event}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={isAdding}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-blue hover:bg-brand-blue/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue disabled:opacity-50"
              >
                <Plus size={18} className="mr-2" />
                Add Webhook
              </button>
            </form>

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900">Configured Endpoints ({outgoingWebhooks.length})</h3>
              {outgoingWebhooks.length === 0 ? (
                <p className="text-gray-500 text-sm">No outgoing webhooks configured.</p>
              ) : (
                outgoingWebhooks.map(webhook => (
                  <div key={webhook.id} className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div className="break-all font-mono text-sm text-gray-800 pr-4">
                        {webhook.url}
                        {webhook.secret && (
                          <div className="text-xs text-gray-500 mt-1">
                            Secret: {webhook.secret.substring(0, 4)}••••••••
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteWebhook(webhook.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {webhook.events.map(event => (
                        <span key={event} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {event}
                        </span>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <button
                        onClick={() => handleTestWebhook(webhook.url, webhook.secret)}
                        className="flex items-center text-sm text-brand-blue hover:text-blue-700 transition-colors"
                      >
                        <Play size={12} className="mr-1" />
                        Test Connection
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Webhooks;
