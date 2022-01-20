import React from 'react'
import './IntBox.css'
import { Link } from 'react-router-dom'

type intBoxProps = {
    header?:string;
    description?:string; 
    link?:string;
}

function IntBox(props: intBoxProps) {
    return (
        <Link className='intbox' to={props.link!}>  
                <p className="intboxHeader">{props.header}</p>
                <p className="intboxDescription">{props.description}</p>
        </Link>
    );
}

export default IntBox;