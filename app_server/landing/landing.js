// Khai landing: terminal replay and scroll reveal (from the DeepCode landing, MIT).
// Terminal replay: rows appear on a schedule, then loop.
  (function(){
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var rows = Array.prototype.slice.call(document.querySelectorAll("#replay .row"));
    if (reduce){ rows.forEach(function(r){ r.classList.add("on"); }); return; }
    var delays = rows.map(function(r){
      if (r.classList.contains("t-dim")) return 120;
      if (r.classList.contains("t-user")) return 700;
      if (r.classList.contains("t-tool")) return 620;
      if (r.classList.contains("t-elbow")) return 420;
      if (r.classList.contains("t-plan")) return 200;
      if (r.classList.contains("t-text") || r.classList.contains("t-foot")) return 640;
      return 200;
    });
    function play(){
      rows.forEach(function(r){ r.classList.remove("on"); });
      var t = 300;
      rows.forEach(function(r,i){
        t += delays[i];
        setTimeout(function(){ r.classList.add("on"); }, t);
      });
      setTimeout(play, t + 7000);
    }
    play();
  })();

  // Scroll reveal.
  (function(){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add("in-view"); io.unobserve(e.target); }
      });
    }, {rootMargin:"0px 0px -8% 0px"});
    document.querySelectorAll(".rv").forEach(function(el){ io.observe(el); });
  })();
