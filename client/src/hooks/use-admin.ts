import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

export function useAdmin() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data, isLoading: adminLoading } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/auth/admin-status"],
    queryFn: async () => {
      const response = await fetch("/api/auth/admin-status", {
        credentials: "include",
      });
      if (response.status === 401) {
        return { isAdmin: false };
      }
      if (!response.ok) {
        return { isAdmin: false };
      }
      return response.json();
    },
    enabled: isAuthenticated,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  return {
    isAdmin: data?.isAdmin ?? false,
    isLoading: authLoading || adminLoading,
  };
}
