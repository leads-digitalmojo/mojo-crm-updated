import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { 
    Activity, 
    Calendar, 
    MapPin, 
    Monitor, 
    User as UserIcon, 
    Search,
    RefreshCw,
    Shield,
    Globe,
    ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';

const Logs: React.FC = () => {
    const { loginLogs, fetchLoginLogs } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        handleRefresh();
    }, []);

    const handleRefresh = async () => {
        setIsLoading(true);
        await fetchLoginLogs();
        setIsLoading(false);
    };

    const filteredLogs = loginLogs.filter(log => 
        log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.ip.includes(searchTerm) ||
        (log.city && log.city.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const getBrowserIcon = (userAgent: string) => {
        if (userAgent.includes('Chrome')) return 'Chrome';
        if (userAgent.includes('Firefox')) return 'Firefox';
        if (userAgent.includes('Safari')) return 'Safari';
        if (userAgent.includes('Edge')) return 'Edge';
        return 'Browser';
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <Activity className="text-primary w-8 h-8" />
                        System Access Logs
                    </h1>
                    <p className="text-gray-500 mt-1">Monitor user authentication and security activity</p>
                </div>
                
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleRefresh}
                        className="bg-white border border-gray-200 p-2.5 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
                        disabled={isLoading}
                    >
                        <RefreshCw className={`w-5 h-5 text-gray-600 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search logs..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm w-full md:w-64"
                        />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Location / Network</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Security</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Devices</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center justify-center">
                                            <div className="bg-gray-50 p-4 rounded-full mb-4">
                                                <Activity className="w-8 h-8 text-gray-300" />
                                            </div>
                                            <p className="text-gray-500 font-medium">No logs found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden">
                                                    <UserIcon className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-gray-900">{log.userName}</div>
                                                    <div className="text-xs text-gray-500">{log.userEmail}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2 text-sm text-gray-700">
                                                <Calendar className="w-4 h-4 text-gray-400" />
                                                {format(new Date(log.timestamp), 'MMM d, yyyy • HH:mm:ss')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                                    <MapPin className="w-4 h-4 text-primary" />
                                                    {log.city || 'Unknown City'}, {log.country || 'Unknown Country'}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                                    <Globe className="w-3 h-3" />
                                                    {log.ip} • <span className="opacity-75">{log.org?.split(' ').slice(0, 3).join(' ')}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap gap-2">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                                    log.locationPermission === 'granted' 
                                                    ? 'bg-green-50 text-green-700 border border-green-100' 
                                                    : 'bg-red-50 text-red-700 border border-red-100'
                                                }`}>
                                                    <Shield className="w-3 h-3" />
                                                    Loc: {log.locationPermission}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex flex-col items-end gap-1">
                                                <div className="flex items-center gap-1.5 text-xs text-gray-700 font-medium bg-gray-100 px-2 py-1 rounded-md">
                                                    <Monitor className="w-3 h-3" />
                                                    {getBrowserIcon(log.userAgent)}
                                                </div>
                                                {log.loc && log.loc !== 'Unknown' && (
                                                    <a 
                                                        href={`https://www.google.com/maps?q=${log.loc}`} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                                                    >
                                                        View Map <ExternalLink className="w-2 h-2" />
                                                    </a>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Logs;
