import React from 'react';
import './Home.css'
import Navbar from '../../nav/Navbar'
import Header from '../../header/Header'
import Section from '../../section/Section'
import Box from '../../box/Box'




function Home() {
    return (
        <main className='main'>

            <Navbar />

            <Header />

            <Section header="Projects" description="things i've built" />

            <div className='container'>
                <Box header='myFitness Manager' description='USAF fitness management platform' link='/comingsoon' />
                <Box header='Citation Builder' description='A workplace citation generator for specific requirements' link='/comingsoon' />
            </div>

            <Section header="Digital Garden" description="a place for my ideas to grow" />

            <div className='container'>
                <Box header='Changing Careers' description="coming soon" link='/comingsoon'/>
                <Box header='Tools I use' description="coming soon" link='/comingsoon'/>
            </div>

            <a className="source1" href="https://github.com/daniel-daum/daniel-daum.github.io">View Source</a>



        </main>
    );
}

export default Home;