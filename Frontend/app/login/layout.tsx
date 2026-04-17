export default function LoginRouteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] min-h-[100vh] overflow-hidden">
      {children}
    </div>
  );
}
