import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/useAuth";

function Spinner() {
  return (
    <div className="center-page">
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

function Login() {
  const { signInWithGoogle } = useAuth();
  return (
    <div className="center-page">
      <div className="login-card">
        <h1 className="app-title">Collection Pit</h1>
        <p className="tagline">Your MTG collection, everywhere.</p>
        <button
          className="primary-btn"
          onClick={() => {
            void signInWithGoogle();
          }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

function Home() {
  const { user, signOutUser } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <span className="app-title">Collection Pit</span>
        <span className="user-email">{user?.email}</span>
        <button
          className="ghost-btn"
          onClick={() => {
            void signOutUser();
          }}
        >
          Sign out
        </button>
      </header>
      <main className="content">
        <p className="placeholder">Your collection will appear here.</p>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {user ? (
          <>
            <Route path="/" element={<Home />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
