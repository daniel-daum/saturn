import React from 'react'
import './Header.css'
// import GitHubIcon from '@mui/icons-material/GitHub';
// import LinkedInIcon from '@mui/icons-material/LinkedIn';

function Header(){
    return(
        <header className="header">
            <h1 className="headerName">Daniel Daum</h1>
            <p className="headerBio">Intelligence analyst, student, aspiring software engineer</p>
            
            {/* <a className="github" href="https://www.github.com/daniel-daum"> <GitHubIcon sx={{fontSize: 50}}/></a>
            <a className="linkedin" href="https://www.linkedin.com/in/daniel-daum-189151203"> <LinkedInIcon sx={{fontSize: 50}}/></a> */}
            
           
        </header>    
    );
}

export default Header;