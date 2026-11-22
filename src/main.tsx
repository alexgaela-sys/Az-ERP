import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CloudGate} from './components/cloud/CloudGate.tsx';
import {LicenseGate} from './components/license/LicenseGate.tsx';
import {CLOUD_STORAGE_MODE} from './services/db.ts';
import './index.css';

// Default build: the ERP exactly as before (data in this browser).
// Cloud build (VITE_ERP_STORAGE=supabase): the same ERP, started behind the
// cloud gate (sign-in, load shared data, first-time import).
//
// LicenseGate wraps BOTH builds, outside everything else: it checks the
// software's own activation (separate from Supabase sign-in and from which
// ERP user is logged in) before any of the rest of the app runs.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LicenseGate>
      {CLOUD_STORAGE_MODE ? (
        <CloudGate>
          <App />
        </CloudGate>
      ) : (
        <App />
      )}
    </LicenseGate>
  </StrictMode>,
);
