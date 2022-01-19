import React from 'react'
import './Navbar.css'


function Navbar() {
    return (
        <nav className='nav'>
            <a href="/">home</a>
            <a href="/blog">blog</a>
            <a href="/about">about</a>
            <a href="/contact">contact</a>
        </nav>
    );
}


export default Navbar;