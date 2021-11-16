const projectLink = document.getElementById('proj');

var timesClicked = 0;

projectLink.addEventListener('click', function transitionMan() {

    timesClicked++;

    if (timesClicked % 2 == 0) {

        //STARTING POSITION. IF CLICKED OFF

        document.getElementById('right').style.flexGrow = 0;
        document.getElementById('right').style.transition = '2s';
        document.getElementById('right').style.marginRight = '0%';
        document.getElementById('right').style.borderLeft = '0px solid #FFFFFF';
        document.getElementById('nav').style.width = '0px';
        document.getElementById('nav').style.transition = '2s';
        document.getElementById('nav').style.borderBottom = '0px solid #FFFFFF';





    } else {

        //If CLICKED ON.

        document.getElementById('right').style.marginRight = '10%';
        document.getElementById('right').style.flexGrow = 3;
        document.getElementById('right').style.transition = '2s';
        document.getElementById('right').style.borderLeft = '1px solid #EAEAEA';
        document.getElementById('nav').style.width = '60em';
        document.getElementById('nav').style.transition = '2s';
        document.getElementById('nav').style.borderBottom = '1px solid #EAEAEA';





    }


})


const homeLink = document.getElementById('dog');

homeLink.addEventListener('click', function() {

    //IF CLICKED OFF

    document.getElementById('right').style.flexGrow = 0;
    document.getElementById('right').style.transition = '2s';
    document.getElementById('right').style.marginRight = '0%';
    document.getElementById('right').style.borderLeft = '0px solid #FFFFFF';
    document.getElementById('nav').style.width = '0px';
    document.getElementById('nav').style.transition = '2s';
    document.getElementById('nav').style.borderBottom = '0px solid #FFFFFF';




})