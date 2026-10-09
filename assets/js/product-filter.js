$(document).ready(function(){

    $('#categories').on('click', '.btn-categories', function(){

        if (this.id == 'all') {
            $('#parent > div').fadeIn(450);
        } else {
            var $el = $('.' + this.id).fadeIn(450);
            $('#parent > div').not($el).hide();
        }
 
        $("#categories .btn-categories").removeClass("active");
        $(this).addClass('active');

    });

 
    function searchProducts () {        
        $("#categories .btn-categories").removeClass("active");
        var matcher = new RegExp($("#search").val(), 'gi');
        $('.box').show().not(function(){
            return matcher.test($(this).find('.name, .sku').text())
        }).hide();
    }

    let $search = $("#search").on('input',function(){
        searchProducts();       
    });


    $('body').on('click', '#jq-keyboard button', function(e) {
        if($("#search").is(":focus")) {
            searchProducts(); 
        }          
    });


    function searchOpenOrders() {
        var matcher = new RegExp($("#holdOrderInput").val(), 'gi');
        $('.order').show().not(function(){
            return matcher.test($(this).find('.ref_number').text())
        }).hide();

    }

    var $searchHoldOrder = $("#holdOrderInput").on('input',function () {
        searchOpenOrders();
    });


    $('body').on('click', '.holdOrderKeyboard .key', function() {
        if($("#holdOrderInput").is(":focus")) {
            searchOpenOrders(); 
        }          
    });
 
  
    function searchCustomerOrders() {
        var matcher = new RegExp($("#holdCustomerOrderInput").val(), 'gi');
        $('.customer-order').show().not(function(){
            return matcher.test($(this).find('.customer_name').text())
        }).hide();
    }

    var $searchCustomerOrder = $("#holdCustomerOrderInput").on('input',function () {
        searchCustomerOrders();
    });


    $('body').on('click', '.customerOrderKeyboard .key', function() {
        if($("#holdCustomerOrderInput").is(":focus")) {
            searchCustomerOrders();
        }          
    });
 


    // Which amount field the on-screen keypad currently types into. In split
    // mode there are two amount boxes (M-Pesa + Cash); the keypad follows the
    // last field the cashier tapped, defaulting to the single Payment box.
    var payField = '#payment';

    $('.split-amount').on('focus click', function () {
        payField = '#' + this.id;
    });
    $('#payment').on('focus click', function () {
        payField = '#payment';
    });

    // Resolves the field the keypad should write to *right now*. The last
    // tapped field may have been hidden by a payment-method switch (e.g. the
    // cashier picked Split without tapping a split box first, so payField
    // still points at the hidden single Payment box), so fall back to whichever
    // amount box is actually visible instead of typing into a hidden input.
    function currentPayField() {
        var $target = $(payField);
        if ($target.length && $target.is(':visible')) return payField;
        if ($('#splitPayBox').is(':visible')) return '#splitMpesa';
        if ($('#payment').is(':visible')) return '#payment';
        return payField;
    }


    $.fn.go = function (value,isDueInput) {
        if(isDueInput){
            $("#refNumber").val($("#refNumber").val()+""+value)
        }else{
            var $target = $(currentPayField());
            $target.val($target.val()+""+value);
            $(this).calculateChange();
        }
    }


    $.fn.digits = function(){
        var $target = $(currentPayField());
        $target.val($target.val()+".");
        $(this).calculateChange();
    }

    // Backspace on whichever amount box the keypad is writing to.
    $.fn.payBackspace = function () {
        var $target = $(currentPayField());
        $target.val(String($target.val()).slice(0, -1));
        $(this).calculateChange();
    }

    // Clear the active amount box (the AC key).
    $.fn.payClear = function () {
        $(currentPayField()).val('');
        $(this).calculateChange();
    }

    // Total actually tendered: single Payment box, or the sum of the split boxes.
    $.fn.tenderedAmount = function () {
        if ($("#splitPayBox").is(":visible")) {
            var mpesa = parseFloat($("#splitMpesa").val()) || 0;
            var cash = parseFloat($("#splitCash").val()) || 0;
            return mpesa + cash;
        }
        return parseFloat($("#payment").val()) || 0;
    }

    $.fn.calculateChange = function () {
        var payable = parseFloat($("#payablePrice").val()) || 0;
        var paid = $(this).tenderedAmount();
        var change = paid - payable;
        if(change > 0){
            $("#change").text(change.toFixed(2));
        }else{
            $("#change").text('0')
        }
        if(paid >= payable && payable > 0){
            $("#confirmPayment").show();
        }else{
            $("#confirmPayment").hide();
        }
    }

})