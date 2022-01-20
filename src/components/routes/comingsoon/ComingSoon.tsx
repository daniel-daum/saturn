import React from 'react'
import './ComingSoon.css'
import Navbar from '../../nav/Navbar';

function ComingSoon() {
    return (
        <div className='soonContainter' >
            <Navbar />
            <div className="soon">
                <p className="comingSoonText">Coming Soon</p>
            </div>

        </div>
    );
}

export default ComingSoon;