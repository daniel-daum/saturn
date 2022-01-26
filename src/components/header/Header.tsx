import React from 'react'
import './Header.css'
// import GitHubIcon from '@mui/icons-material/GitHub';
// import LinkedInIcon from '@mui/icons-material/LinkedIn';

function Header(){
    return(
        <header className="header">
            <h1 className="headerName">Daniel Daum</h1>
            <p className="headerBio">Intelligence analyst, student, aspiring software engineer</p>
            
            <a href="https://github.com/daniel-daum/">Github</a>
            <a href="https://www.linkedin.com/in/daniel-daum-189151203/">Linkedin</a>
            
            
           
        </header>    
    );
}

export default Header;