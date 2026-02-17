export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

// Redirect to login with a toast notification
export function redirectToLogin(toast?: (options: { title: string; description: string; variant: string }) => void) {
  if (toast) {
    toast({
      title: "غير مصرح",
      description: "انتهت الجلسة. يتم إعادة توجيهك لتسجيل الدخول...",
      variant: "destructive",
    });
  }
  setTimeout(() => {
    window.location.href = "/auth";
  }, 500);
}
