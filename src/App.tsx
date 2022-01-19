import React from 'react';
import {BrowserRouter as Router, Routes, Route} from "react-router-dom";
import Home from './components/routes/home/Home'
import ComingSoon from './components/routes/comingsoon/ComingSoon'


function App() {
  return (
    <div>
      <Router>
        <Routes>
          <Route path="/" element={<Home/>} />
          <Route path="/blog" element={<ComingSoon/>} />
          <Route path="/about" element={<ComingSoon/>} />
          <Route path="/contact" element={<ComingSoon/>} />
          <Route path="/comingsoon" element={<ComingSoon/>} />
        </Routes>
      </Router>
     
    </div>
  );
}

export default App;
