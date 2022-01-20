import React from 'react'
import './Navbar.css'
import { Link } from 'react-router-dom'


function Navbar() {
    return (
        <nav className='nav'>            
            <Link to="/">home</Link>
            <Link to="/about">about</Link>
            <Link to="/blog">blog</Link>
            <Link to="/contact">contact</Link>
        </nav>
    );
}


export default Navbar;