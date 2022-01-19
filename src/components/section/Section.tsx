import React from 'react'
import './Section.css'

type sectionProps ={
    header?:string;
    description?:string;
}

function Section(props: sectionProps){
    return(
        <section className='section'>
            <p className="sectionHeader">{props.header}</p>
            <p className="sectionDescription">{props.description}</p>
        </section>
    );
}

export default Section;