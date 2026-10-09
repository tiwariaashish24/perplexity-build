
import {BrowserRouter, Route, Routes} from 'react-router'
import Auth from './pages/Auth';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
