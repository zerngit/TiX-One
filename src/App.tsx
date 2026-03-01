import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
import { CheckInListener } from './components/CheckInListener';

export default function App() {
  return (
    <AuthProvider>
      <CheckInListener />
      <RouterProvider router={router} />
    </AuthProvider>
  );
}