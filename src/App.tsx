import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import { Shell } from "./components/Shell";

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
  return <Shell />;
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
