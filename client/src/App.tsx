import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useAdmin } from "@/hooks/use-admin";
import NotFound from "@/pages/not-found";

// Pages
import Library from "@/pages/Library";
import LawDetail from "@/pages/LawDetail";
import About from "@/pages/About";
import ErrorReports from "@/pages/ErrorReports";

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoading } = useAdmin();

  if (isLoading) return null;
  if (!isAdmin) return <Redirect to="/" />;

  return <Component />;
}

import Judgments from "@/pages/Judgments";
import JudgmentDetail from "@/pages/JudgmentDetail";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Library} />
      <Route path="/library" component={Library} />
      <Route path="/judgments" component={Judgments} />
      <Route path="/judgments/:id" component={JudgmentDetail} />
      <Route path="/about" component={About} />
      <Route path="/law/:id" component={LawDetail} />
      <Route path="/admin/reports">{() => <AdminRoute component={ErrorReports} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex flex-col min-h-screen font-sans bg-background text-foreground" dir="rtl" style={{ fontFamily: '"Noto Sans Arabic", sans-serif' }}>
          <Navbar />
          <main className="flex-grow">
            <Router />
          </main>
          <Footer />
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
