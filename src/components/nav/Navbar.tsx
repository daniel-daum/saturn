import React from 'react'
import './Navbar.css'
import { Link } from 'react-router-dom'


function Navbar() {
    return (
        <nav className='nav'>
            {/* <a href="/">home</a>
            <a href="/blog">blog</a>
            <a href="/about">about</a>
            <a href="/contact">contact</a> */}
            <Link to="/">home</Link>
            <Link to="/about">about</Link>
            <Link to="/blog">blog</Link>
            <Link to="/contact">contact</Link>
            <Link to="/contact">test</Link>
        </nav>
    );
}


export default Navbar;