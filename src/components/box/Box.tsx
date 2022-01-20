import React from 'react'
import './Box.css'
import { Link } from 'react-router-dom'


type boxProps = {
    header?:string;
    description?:string; 
    link?:string;
}

function Box(props: boxProps){
    return(
        <a className="box" href={props.link}>
                <p className="boxHeader">{props.header}</p>
                <p className="boxDescription">{props.description}</p>
        </a>
    );
}

export default Box;