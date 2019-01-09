package io.symphonia;

import com.amazonaws.services.lambda.runtime.Context;

import java.util.Date;

@SuppressWarnings("unused")
public class DataGenerator {
    public String handler(Object o, Context context) throws InterruptedException {
        String message = String.format("Lambda with %dMB memory invoked at %tc", context.getMemoryLimitInMB(), new Date());
        Thread.sleep(50);
        System.out.println(message);
        return message;
    }
}