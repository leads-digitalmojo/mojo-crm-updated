import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children?: ReactNode;
  fallbackName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-red-100 shadow-sm transition-all animate-in fade-in duration-500">
          <div className="bg-red-50 p-4 rounded-full mb-6">
            <AlertCircle className="w-12 h-12 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-500 text-center max-w-md mb-8">
            An error occurred while loading the {this.props.fallbackName || 'component'}. This is likely due to missing or corrupted data in the system.
          </p>
          
          <div className="flex gap-4">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 bg-brand-blue text-white px-6 py-3 rounded-xl font-bold hover:bg-brand-blue/90 transition-all shadow-lg active:scale-95"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Page
            </button>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 transition-all"
            >
              Try again
            </button>
          </div>
          
          {/* Show diagnostics even in production temporarily to catch the intermittent dashboard crash */}
          {this.state.error && (
            <div className="mt-8 p-6 bg-red-50/50 rounded-xl text-left w-full max-w-2xl overflow-hidden border border-red-100 shadow-inner">
              <p className="text-xs font-bold text-red-800 uppercase tracking-widest mb-2 opacity-50">Developer Diagnostic Info</p>
              <div className="overflow-auto max-h-[200px] scrollbar-thin scrollbar-thumb-red-200">
                <p className="text-xs font-mono text-red-600 whitespace-pre-wrap leading-relaxed">
                  {this.state.error?.stack || this.state.error?.toString()}
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
