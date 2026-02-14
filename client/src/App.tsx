import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useAdmin } from "@/hooks/use-admin";
import { useEffect } from "react";
import { useAnalytics } from "@/hooks/use-analytics";
import NotFound from "@/pages/not-found";

// Pages
import Library from "@/pages/Library";
import LawDetail from "@/pages/LawDetail";
import About from "@/pages/About";
import ErrorReports from "@/pages/ErrorReports";
import Regulations from "@/pages/Regulations";
import AuthPortal from "@/pages/AuthPortal";
import AdminDashboard from "@/pages/AdminDashboard";

// Scroll to top on every route change (fixes mobile not starting at top)
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoading } = useAdmin();

  if (isLoading) return null;
  if (!isAdmin) return <Redirect to="/" />;

  return <Component />;
}

import Judgments from "@/pages/Judgments";
import JudgmentDetail from "@/pages/JudgmentDetail";
import GazetteIndex from "@/pages/GazetteIndex";

function Router() {
  useAnalytics();

  return (
    <>
      <ScrollToTop />
      <Switch>
        <Route path="/" component={Library} />
        <Route path="/library" component={Library} />
        <Route path="/judgments" component={Judgments} />
        <Route path="/judgments/:id" component={JudgmentDetail} />
        <Route path="/gazette" component={GazetteIndex} />
        <Route path="/about" component={About} />
        <Route path="/auth" component={AuthPortal} />
        <Route path="/regulations" component={Regulations} />
        <Route path="/law/:id" component={LawDetail} />
        <Route path="/admin">{() => <AdminRoute component={AdminDashboard} />}</Route>
        <Route path="/admin/reports">{() => <AdminRoute component={ErrorReports} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </>
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
