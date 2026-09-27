import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import Dashboard from '@/pages/dashboard';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ErrorBoundary>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        </ErrorBoundary>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;