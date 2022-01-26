import React from 'react';
import './Home.css'
import Navbar from '../../nav/Navbar'
import Header from '../../header/Header'
import Section from '../../section/Section'
import Box from '../../box/Box'
import IntBox from '../../intbox/IntBox'




function Home() {
    return (
        <main className='main'>

            <Navbar />

            <Header />

            <Section header="Projects" description="things i'm building" />

            <div className='container'>
                <IntBox header='myFitness Manager' description='USAF fitness management platform' link='/comingsoon' />
                <Box header='Citation Builder' description='A citation generator for specific workplace requirements' link='https://github.com/daniel-daum/citation_builder' />
            </div>

            <Section header="Digital Garden" description="a place for my ideas to grow" />

            <div className='container'>
                <IntBox header='Tools I Use' description="coming soon" link='/comingsoon'/>
                <IntBox header="Create a React-Typescript Project" description="coming soon" link='/comingsoon'/>
            </div>

            <a className="source1" href="https://github.com/daniel-daum/daniel-daum.github.io">
                <p>View Source</p>
            </a>



        </main>
    );
}

export default Home;